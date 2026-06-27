#!/usr/bin/env python3
"""
Sri Lankan Politics — Controversy Archive (CLI explorer)

A zero-dependency terminal tool for browsing the same archive the web UI uses.

Usage:
    python3 cli.py list                      # list all topics, ranked by controversy
    python3 cli.py list --category war       # filter by category id
    python3 cli.py search "easter"           # full-text search
    python3 cli.py show easter-bombings-2019 # full detail for one topic (id or fuzzy title)
    python3 cli.py categories                # list category ids
    python3 cli.py random                    # surface a random controversy
    python3 cli.py validate                  # sanity-check the data file
    python3 cli.py score [id]                 # Evidence Strength score + breakdown
    python3 cli.py rescore                    # bake evidence scores into the data file
    python3 cli.py related <id>               # how a case links to others (+ shared actors)
    python3 cli.py graph --format mermaid     # export the relationship graph (mermaid/dot/json)
    python3 cli.py linkcheck                  # verify every source URL resolves

Add --json to `list`/`search`/`show`/`score`/`linkcheck` for machine-readable output.
"""
import argparse
import concurrent.futures
import json
import os
import random
import signal
import ssl
import sys
import textwrap
import urllib.error
import urllib.request

import scoring

# Exit quietly when output is piped to a closing reader (e.g. `| head`).
try:
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (AttributeError, ValueError):
    pass  # SIGPIPE not available (e.g. Windows)

DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "archive", "topics.json")

# --- tiny ANSI helpers (auto-disabled when not a TTY) ---
_TTY = sys.stdout.isatty()
def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if _TTY else s
def bold(s):   return _c("1", s)
def dim(s):    return _c("2", s)
def red(s):    return _c("31", s)
def green(s):  return _c("32", s)
def yellow(s): return _c("33", s)
def cyan(s):   return _c("36", s)


def load_data():
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        sys.exit(f"Data file not found: {DATA_PATH}")
    except json.JSONDecodeError as e:
        sys.exit(f"Data file is not valid JSON: {e}")


def cat_label(data, cid):
    for c in data.get("categories", []):
        if c["id"] == cid:
            return c["label"]
    return cid


def meter(score):
    filled = round(score)
    bar = "█" * filled + "░" * (10 - filled)
    color = red if score >= 8 else (yellow if score >= 6 else cyan)
    return color(bar) + f" {score}/10"


def grade_badge(ev):
    """Colourised 'Evidence: A (87)' tag."""
    g = ev["grade"]
    color = green if g in ("A", "B") else (yellow if g in ("C", "D") else red)
    return color(f"Evidence {g} ({ev['score']})")


def find_topic(data, key):
    key_l = key.lower()
    topics = data["topics"]
    for t in topics:
        if t["id"] == key:
            return t
    matches = [t for t in topics if key_l in t["id"].lower() or key_l in t["title"].lower()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        print(yellow(f"Ambiguous — {len(matches)} topics match '{key}':"))
        for t in matches:
            print(f"  {cyan(t['id'])}  {t['title']}")
        print(dim("Re-run `show` with one of the ids above."))
        return None
    print(red(f"No topic found for '{key}'."))
    print(dim("Try `python3 cli.py list` to see available ids."))
    return None


def cmd_categories(data, _args):
    for c in data["categories"]:
        n = sum(1 for t in data["topics"] if t["category"] == c["id"])
        print(f"  {cyan(c['id']):<28} {c['label']}  {dim(f'({n})')}")


def _sorted_topics(data, args):
    topics = list(data["topics"])
    if getattr(args, "category", None):
        topics = [t for t in topics if t["category"] == args.category]
    if getattr(args, "query", None):
        q = args.query.lower()
        def hay(t):
            parts = [t["title"], t["summary"], t["era"], t.get("stillContested", ""),
                     " ".join(t.get("actors", [])),
                     " ".join(scoring.claim_text(c) for c in t.get("competingNarratives", [])),
                     " ".join(scoring.claim_text(c) for c in t.get("documentedFacts", []))]
            return " ".join(parts).lower()
        topics = [t for t in topics if q in hay(t)]
    # Featured (priority) topics are pinned to the top, then ranked by controversy.
    topics.sort(key=lambda t: (not t.get("featured", False), -t["controversyScore"]))
    return topics


def _print_list(data, topics):
    if not topics:
        print(dim("No matching topics."))
        return
    for t in topics:
        star = yellow("★ PRIORITY  ") if t.get("featured") else ""
        ev = t.get("evidence") or scoring.evidence_score(t)
        print(f"{meter(t['controversyScore'])}  {grade_badge(ev)}  {star}{bold(t['title'])}")
        print(f"  {cyan(t['id'])}  ·  {dim(cat_label(data, t['category']))}  ·  {dim(t['era'])}")
        print(textwrap.fill(t["summary"], width=88, initial_indent="  ", subsequent_indent="  "))
        print()


def cmd_list(data, args):
    cat = getattr(args, "category", None)
    if cat and cat not in {c["id"] for c in data["categories"]}:
        valid = ", ".join(c["id"] for c in data["categories"])
        print(yellow(f"Unknown category '{cat}'. Valid ids: {valid}"))
        sys.exit(1)
    topics = _sorted_topics(data, args)
    if args.json:
        print(json.dumps(topics, indent=2, ensure_ascii=False))
        return
    _print_list(data, topics)
    print(dim(f"{len(topics)} topic(s). Use `show <id>` for full detail."))


def cmd_search(data, args):
    cmd_list(data, args)


def _wrap(label, text, color=cyan):
    print(color(bold(label)))
    print(textwrap.fill(text, width=90, initial_indent="  ", subsequent_indent="  "))
    print()


def _wrap_claims(label, claims, src_index, color=cyan, bullet="•"):
    """Render claims (str or {text,sourceIds,perspective/evidence}) with [n] cites."""
    print(color(bold(label)))
    for c in claims:
        text = scoring.claim_text(c)
        cites = "".join(f"[{src_index[i]}]" for i in scoring.claim_source_ids(c) if i in src_index)
        tag = scoring.claim_perspective(c) or scoring.claim_evidence(c)
        prefix = dim(f"({tag}) ") if tag else ""
        body = prefix + text + (" " + dim(cites) if cites else "")
        print(textwrap.fill(body, width=90, initial_indent=f"  {bullet} ", subsequent_indent="    "))
    print()


def cmd_show(data, args):
    t = find_topic(data, args.id)
    if not t:
        sys.exit(1)
    if args.json:
        print(json.dumps(t, indent=2, ensure_ascii=False))
        return

    # Number the sources so claims can cite them as [1], [2], …
    src_index = {s["id"]: n for n, s in enumerate(t.get("sources", []), 1) if "id" in s}
    ev = t.get("evidence") or scoring.evidence_score(t)

    print("=" * 92)
    if t.get("featured"):
        print(yellow("★ PRIORITY TOPIC"))
    print(bold(t["title"]))
    print(f"{dim(cat_label(data, t['category']))}  ·  {dim(t['era'])}  ·  "
          f"{meter(t['controversyScore'])}  ·  {grade_badge(ev)}")
    print("=" * 92 + "\n")
    _wrap("SUMMARY", t["summary"])
    _wrap("THE MAINSTREAM ACCOUNT", t["mainstreamAccount"])
    _wrap_claims("COMPETING NARRATIVES", t.get("competingNarratives", []), src_index, yellow)
    _wrap_claims("DOCUMENTED FACTS", t.get("documentedFacts", []), src_index, cyan)
    _wrap("WHAT REMAINS CONTESTED / UNDER-REPORTED", t["stillContested"], red)

    if t.get("actors"):
        print(cyan(bold("KEY ACTORS")))
        print(textwrap.fill(" · ".join(t["actors"]), width=90,
                            initial_indent="  ", subsequent_indent="  "))
        print()

    if t.get("relatedTopics"):
        print(cyan(bold("RELATED CASES")))
        by_id = {x["id"]: x for x in data["topics"]}
        for rel in t["relatedTopics"]:
            title = by_id.get(rel["id"], {}).get("title", rel["id"])
            note = f" — {rel['note']}" if rel.get("note") else ""
            print(f"  • [{yellow(rel.get('relation', 'related'))}] {title}{dim(note)}")
            print(f"    {dim(rel['id'])}")
        print()

    print(cyan(bold("SOURCES")))
    for n, s in enumerate(t.get("sources", []), 1):
        meta = " · ".join(x for x in [s.get("type"), s.get("publisher"), s.get("date")] if x)
        meta = dim(f"  [{meta}]") if meta else ""
        print(f"  {n}. {s['label']}{meta}\n     {dim(s['url'])}")
    print()


def cmd_random(data, _args):
    t = random.choice(data["topics"])
    args = argparse.Namespace(id=t["id"], json=False)
    cmd_show(data, args)


_RELATION_VOCAB = {"caused-by", "led-to", "part-of", "same-actors", "same-era",
                   "accountability-for", "context-for", "contradicts"}


def cmd_validate(data, _args):
    errors = []
    required = ["id", "title", "category", "era", "controversyScore", "summary",
                "mainstreamAccount", "competingNarratives", "documentedFacts",
                "stillContested", "sources"]
    cat_ids = {c["id"] for c in data.get("categories", [])}
    all_ids = {t.get("id") for t in data["topics"]}
    seen = set()
    for i, t in enumerate(data["topics"]):
        ctx = t.get("id", f"#{i}")
        for f in required:
            if f not in t or t[f] in ("", [], None):
                errors.append(f"{ctx}: missing/empty field '{f}'")
        if t.get("id") in seen:
            errors.append(f"{ctx}: duplicate id")
        seen.add(t.get("id"))
        if t.get("category") not in cat_ids:
            errors.append(f"{ctx}: unknown category '{t.get('category')}'")
        if not isinstance(t.get("controversyScore"), (int, float)) or not (0 <= t.get("controversyScore", -1) <= 10):
            errors.append(f"{ctx}: controversyScore must be 0–10")
        if "featured" in t and not isinstance(t["featured"], bool):
            errors.append(f"{ctx}: 'featured' must be true/false")

        # Sources: collect ids, validate URL + type vocabulary.
        src_ids = set()
        for s in t.get("sources", []):
            if not str(s.get("url", "")).startswith("http"):
                errors.append(f"{ctx}: source '{s.get('label')}' has no valid URL")
            if "id" in s:
                if s["id"] in src_ids:
                    errors.append(f"{ctx}: duplicate source id '{s['id']}'")
                src_ids.add(s["id"])
            if s.get("type") and s["type"] not in scoring.TIERS:
                errors.append(f"{ctx}: source '{s.get('id', s.get('label'))}' has unknown type '{s['type']}'")

        # Claims: enriched objects must have text and resolvable sourceIds.
        for field in ("competingNarratives", "documentedFacts"):
            for c in t.get(field, []):
                if isinstance(c, dict):
                    if not c.get("text"):
                        errors.append(f"{ctx}: a {field} entry has empty 'text'")
                    for sid in c.get("sourceIds", []):
                        if sid not in src_ids:
                            errors.append(f"{ctx}: {field} cites unknown sourceId '{sid}'")

        # Relations: ids must exist; relation must be in the vocabulary.
        for rel in t.get("relatedTopics", []):
            if rel.get("id") not in all_ids:
                errors.append(f"{ctx}: relatedTopic points at unknown id '{rel.get('id')}'")
            if rel.get("id") == t.get("id"):
                errors.append(f"{ctx}: relatedTopic points at itself")
            if rel.get("relation") and rel["relation"] not in _RELATION_VOCAB:
                errors.append(f"{ctx}: unknown relation '{rel['relation']}'")

        if "actors" in t and not all(isinstance(a, str) for a in t["actors"]):
            errors.append(f"{ctx}: 'actors' must be a list of strings")

    if errors:
        print(red(f"✗ {len(errors)} issue(s) found:"))
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print(f"✓ {len(data['topics'])} topics, {len(cat_ids)} categories — all valid.")


# --- linkcheck: verify every source URL actually resolves -------------------
_UA = "Mozilla/5.0 (compatible; archive-linkcheck/1.0)"
# HEAD is often rejected by CDNs; these codes trigger a GET retry.
_RETRY_WITH_GET = {400, 403, 405, 406, 501, 999}
# Reachable but refuses automated clients (bot/rate-limit walls) — not a dead link.
_SOFT_BLOCK = {401, 403, 429, 451}


def _ssl_context():
    ctx = ssl.create_default_context()
    # Honour the sandbox's outbound proxy CA so HTTPS verification succeeds.
    bundle = os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt"
    if os.path.exists(bundle):
        try:
            ctx.load_verify_locations(cafile=bundle)
        except Exception:
            pass
    return ctx


def _check_url(url, ctx, timeout):
    def fetch(method):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": _UA})
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)
    try:
        try:
            resp = fetch("HEAD")
        except urllib.error.HTTPError as e:
            if e.code in _RETRY_WITH_GET:
                resp = fetch("GET")
            else:
                raise
        with resp:
            return resp.status, None
    except urllib.error.HTTPError as e:
        return e.code, e.reason
    except (urllib.error.URLError, ssl.SSLError, OSError) as e:
        return None, str(getattr(e, "reason", e))
    except Exception as e:  # pragma: no cover - defensive
        return None, f"{type(e).__name__}: {e}"


def cmd_linkcheck(data, args):
    refs = {}   # url -> [(topic_id, label), ...]
    order = []  # preserve first-seen order, de-duplicated
    for t in data["topics"]:
        for s in t.get("sources", []):
            url = s.get("url", "")
            if url not in refs:
                refs[url] = []
                order.append(url)
            refs[url].append((t["id"], s.get("label", "")))

    if not order:
        print(dim("No source URLs to check."))
        return

    ctx = _ssl_context()
    # Progress note goes to stderr so `--json` stdout stays clean/pipeable.
    print(dim(f"Checking {len(order)} unique URL(s) across {len(data['topics'])} "
              f"topics (timeout {args.timeout}s)…\n"), file=sys.stderr)

    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(_check_url, u, ctx, args.timeout): u for u in order}
        for fut in concurrent.futures.as_completed(futs):
            results[futs[fut]] = fut.result()

    counts = {"ok": 0, "blocked": 0, "broken": 0}
    payload = []
    for u in order:
        status, info = results[u]
        if isinstance(status, int) and status < 400:
            cat = "ok"
        elif status in _SOFT_BLOCK:
            cat = "blocked"  # reachable, but refuses automated clients
        else:
            cat = "broken"
        counts[cat] += 1
        payload.append({
            "url": u, "status": status, "category": cat, "info": info,
            "references": [{"topic": tid, "label": lab} for tid, lab in refs[u]],
        })

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        tags = {
            "ok": lambda c: green(f"✓ {c}"),
            "blocked": lambda c: yellow(f"‼ {c}"),
            "broken": lambda c: red(f"✗ {c}"),
        }
        for row in payload:
            code = row["status"] if row["status"] is not None else "ERR"
            print(f"{tags[row['category']](code)}  {row['url']}")
            tid, label = row["references"][0]["topic"], row["references"][0]["label"]
            extra = f"  (+{len(row['references']) - 1} more)" if len(row["references"]) > 1 else ""
            print(f"        {dim(label)} — {dim(tid)}{extra}")
            if row["category"] == "blocked":
                print(f"        {yellow('blocks automated requests — verify in a browser')}")
            elif row["category"] == "broken" and row["info"]:
                print(f"        {red(row['info'])}")
        print()
        summary = (f"{counts['ok']} ok, {counts['blocked']} blocked, "
                   f"{counts['broken']} broken — {len(order)} total")
        if counts["broken"]:
            print(red(bold("✗ " + summary)))
        elif counts["blocked"]:
            print(yellow(bold("‼ " + summary)))
        else:
            print(green(bold("✓ " + summary)))

    if counts["broken"]:
        sys.exit(1)


def cmd_score(data, args):
    target = getattr(args, "id", None)
    if target:
        t = find_topic(data, target)
        if not t:
            sys.exit(1)
        rows = [(t, scoring.evidence_score(t))]
    else:
        rows = [(t, scoring.evidence_score(t)) for t in data["topics"]]

    if args.json:
        print(json.dumps([dict(id=t["id"], **ev) for t, ev in rows], indent=2, ensure_ascii=False))
        return

    if len(rows) == 1:
        t, ev = rows[0]
        note = "enriched — claims individually cited" if ev["enriched"] \
            else "legacy — claims not yet individually cited"
        print(bold(t["title"]))
        print(f"{grade_badge(ev)}   {dim('(' + note + ')')}\n")
        for k in ("authority", "diversity", "citationCoverage", "corroboration", "balance"):
            got, mx = ev["components"][k], ev["maxComponents"][k]
            filled = round(24 * (got / mx)) if mx else 0
            bar = "█" * filled + "░" * (24 - filled)
            print(f"  {k:<17} {bar} {got:>4}/{mx}")
        print(f"\n  {'TOTAL':<17} {' ' * 24} {bold(str(ev['score']))}/100  →  grade {bold(ev['grade'])}")
        print(dim("\nEvidence Strength measures how well-sourced THIS entry is — not whether "
                  "its claims are true."))
    else:
        rows.sort(key=lambda r: r[1]["score"], reverse=True)
        for t, ev in rows:
            g = ev["grade"]
            color = green if g in ("A", "B") else (yellow if g in ("C", "D") else red)
            print(f"  {color(g)}  {ev['score']:>3}/100  {t['title']}")
        dist = {}
        for _, ev in rows:
            dist[ev["grade"]] = dist.get(ev["grade"], 0) + 1
        print(dim("\n" + "  ".join(f"{g}:{dist.get(g, 0)}" for g in "ABCDF")))


def _incoming(data, tid):
    """Topics that link TO tid (relations are stored on the source topic)."""
    out = []
    for x in data["topics"]:
        for r in x.get("relatedTopics", []):
            if r.get("id") == tid:
                out.append((x, r.get("relation", "related"), r.get("note", "")))
    return out


def cmd_related(data, args):
    t = find_topic(data, args.id)
    if not t:
        sys.exit(1)
    by_id = {x["id"]: x for x in data["topics"]}
    outgoing = [(by_id.get(r["id"]), r.get("relation", "related"), r.get("note", ""))
                for r in t.get("relatedTopics", []) if r.get("id") in by_id]
    incoming = _incoming(data, t["id"])
    my_actors = set(t.get("actors", []))
    shared = []
    for x in data["topics"]:
        if x["id"] == t["id"]:
            continue
        common = my_actors & set(x.get("actors", []))
        if common:
            shared.append((x, sorted(common)))

    if args.json:
        print(json.dumps({
            "id": t["id"],
            "outgoing": [{"id": x["id"], "relation": rel, "note": note} for x, rel, note in outgoing],
            "incoming": [{"id": x["id"], "relation": rel, "note": note} for x, rel, note in incoming],
            "sharedActors": [{"id": x["id"], "actors": a} for x, a in shared],
        }, indent=2, ensure_ascii=False))
        return

    print(bold(t["title"]) + "\n")
    def block(title, rows):
        print(cyan(bold(title)))
        if not rows:
            print(dim("  (none)"))
        for x, rel, note in rows:
            note = f" — {note}" if note else ""
            print(f"  • [{yellow(rel)}] {x['title']}{dim(note)}\n    {dim(x['id'])}")
        print()
    block("LINKS OUT (this case → others)", outgoing)
    block("LINKS IN (others → this case)", [(x, rel, note) for x, rel, note in incoming])
    print(cyan(bold("SHARED ACTORS")))
    if not shared:
        print(dim("  (none)"))
    for x, actors in sorted(shared, key=lambda s: -len(s[1])):
        print(f"  • {x['title']}\n    {dim(', '.join(actors))}  ({dim(x['id'])})")
    print()


def cmd_graph(data, args):
    edges = []
    for t in data["topics"]:
        for r in t.get("relatedTopics", []):
            edges.append((t["id"], r.get("id"), r.get("relation", "related")))
    by_id = {t["id"]: t for t in data["topics"]}

    if args.format == "json":
        print(json.dumps({
            "nodes": [{"id": t["id"], "title": t["title"], "category": t["category"],
                       "controversyScore": t["controversyScore"],
                       "evidence": (t.get("evidence") or {}).get("grade")}
                      for t in data["topics"]],
            "edges": [{"source": s, "target": d, "relation": rel} for s, d, rel in edges],
        }, indent=2, ensure_ascii=False))
    elif args.format == "dot":
        print("digraph archive {")
        print('  rankdir=LR; node [shape=box, style=rounded];')
        for t in data["topics"]:
            print(f'  "{t["id"]}" [label="{t["title"]}"];')
        for s, d, rel in edges:
            print(f'  "{s}" -> "{d}" [label="{rel}"];')
        print("}")
    else:  # mermaid
        print("graph LR")
        for t in data["topics"]:
            label = t["title"].replace('"', "'")
            print(f'  {t["id"].replace("-", "_")}["{label}"]')
        for s, d, rel in edges:
            print(f'  {s.replace("-", "_")} -->|{rel}| {d.replace("-", "_")}')


def cmd_rescore(data, _args):
    for t in data["topics"]:
        ev = scoring.evidence_score(t)
        t["evidence"] = {"score": ev["score"], "grade": ev["grade"],
                         "components": ev["components"], "maxComponents": ev["maxComponents"]}
    with open(DATA_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    grades = {}
    for t in data["topics"]:
        g = t["evidence"]["grade"]
        grades[g] = grades.get(g, 0) + 1
    print(f"✓ Rescored {len(data['topics'])} topics into {os.path.basename(DATA_PATH)}  "
          + dim("(" + "  ".join(f"{g}:{grades.get(g, 0)}" for g in 'ABCDF') + ")"))


def main():
    p = argparse.ArgumentParser(
        description="Explore the Sri Lankan Politics Controversy Archive.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="cmd")

    pl = sub.add_parser("list", help="list topics")
    pl.add_argument("--category", help="filter by category id")
    pl.add_argument("--json", action="store_true")

    ps = sub.add_parser("search", help="full-text search")
    ps.add_argument("query")
    ps.add_argument("--category", help="filter by category id")
    ps.add_argument("--json", action="store_true")

    psh = sub.add_parser("show", help="show full detail for one topic")
    psh.add_argument("id", help="topic id or part of its title")
    psh.add_argument("--json", action="store_true")

    sub.add_parser("categories", help="list category ids")
    sub.add_parser("random", help="show a random controversy")
    sub.add_parser("validate", help="validate the data file")

    psc = sub.add_parser("score", help="show Evidence Strength score + breakdown")
    psc.add_argument("id", nargs="?", help="topic id/title; omit for the whole archive")
    psc.add_argument("--json", action="store_true")

    sub.add_parser("rescore", help="recompute Evidence scores and bake them into the data file")

    prel = sub.add_parser("related", help="show how a case links to others")
    prel.add_argument("id", help="topic id or part of its title")
    prel.add_argument("--json", action="store_true")

    pgr = sub.add_parser("graph", help="export the relationship graph")
    pgr.add_argument("--format", choices=["mermaid", "dot", "json"], default="mermaid")

    plc = sub.add_parser("linkcheck", help="ping every source URL and report broken links")
    plc.add_argument("--timeout", type=int, default=15, help="per-request timeout in seconds")
    plc.add_argument("--workers", type=int, default=8, help="concurrent requests")
    plc.add_argument("--json", action="store_true")

    args = p.parse_args()
    data = load_data()

    dispatch = {
        "list": cmd_list, "search": cmd_search, "show": cmd_show,
        "categories": cmd_categories, "random": cmd_random,
        "validate": cmd_validate, "score": cmd_score, "rescore": cmd_rescore,
        "related": cmd_related, "graph": cmd_graph, "linkcheck": cmd_linkcheck,
    }
    if not args.cmd:
        # Default: a friendly overview
        print(bold(data["meta"]["title"]) + "\n")
        print(textwrap.fill(data["meta"]["description"], width=90) + "\n")
        cmd_list(data, argparse.Namespace(category=None, query=None, json=False))
        print(dim("\nTip: `python3 cli.py show <id>` for the full dossier, or `--help` for all commands."))
        return
    dispatch[args.cmd](data, args)


if __name__ == "__main__":
    main()
