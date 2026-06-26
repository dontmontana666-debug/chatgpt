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

Add --json to `list`/`search`/`show` for machine-readable output.
"""
import argparse
import json
import os
import random
import signal
import sys
import textwrap

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
        print(yellow(f"Ambiguous — {len(matches)} matches:"))
        for t in matches:
            print(f"  {cyan(t['id'])}  {t['title']}")
        return None
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
                     " ".join(t.get("competingNarratives", [])),
                     " ".join(t.get("documentedFacts", []))]
            return " ".join(parts).lower()
        topics = [t for t in topics if q in hay(t)]
    topics.sort(key=lambda t: t["controversyScore"], reverse=True)
    return topics


def _print_list(data, topics):
    if not topics:
        print(dim("No matching topics."))
        return
    for t in topics:
        print(f"{meter(t['controversyScore'])}  {bold(t['title'])}")
        print(f"  {cyan(t['id'])}  ·  {dim(cat_label(data, t['category']))}  ·  {dim(t['era'])}")
        print(textwrap.fill(t["summary"], width=88, initial_indent="  ", subsequent_indent="  "))
        print()


def cmd_list(data, args):
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


def _wrap_items(label, items, color=cyan, bullet="•"):
    print(color(bold(label)))
    for it in items:
        print(textwrap.fill(it, width=90, initial_indent=f"  {bullet} ",
                            subsequent_indent="    "))
    print()


def cmd_show(data, args):
    t = find_topic(data, args.id)
    if not t:
        if args.id not in [x["id"] for x in data["topics"]]:
            print(red(f"No topic found for '{args.id}'."))
        sys.exit(1)
    if args.json:
        print(json.dumps(t, indent=2, ensure_ascii=False))
        return

    print("=" * 92)
    print(bold(t["title"]))
    print(f"{dim(cat_label(data, t['category']))}  ·  {dim(t['era'])}  ·  {meter(t['controversyScore'])}")
    print("=" * 92 + "\n")
    _wrap("SUMMARY", t["summary"])
    _wrap("THE MAINSTREAM ACCOUNT", t["mainstreamAccount"])
    _wrap_items("COMPETING NARRATIVES", t.get("competingNarratives", []), yellow)
    _wrap_items("DOCUMENTED FACTS", t.get("documentedFacts", []), cyan)
    _wrap("WHAT REMAINS CONTESTED / UNDER-REPORTED", t["stillContested"], red)
    print(cyan(bold("SOURCES")))
    for s in t.get("sources", []):
        print(f"  • {s['label']}\n    {dim(s['url'])}")
    print()


def cmd_random(data, _args):
    t = random.choice(data["topics"])
    args = argparse.Namespace(id=t["id"], json=False)
    cmd_show(data, args)


def cmd_validate(data, _args):
    errors = []
    required = ["id", "title", "category", "era", "controversyScore", "summary",
                "mainstreamAccount", "competingNarratives", "documentedFacts",
                "stillContested", "sources"]
    cat_ids = {c["id"] for c in data.get("categories", [])}
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
        for s in t.get("sources", []):
            if not str(s.get("url", "")).startswith("http"):
                errors.append(f"{ctx}: source '{s.get('label')}' has no valid URL")

    if errors:
        print(red(f"✗ {len(errors)} issue(s) found:"))
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print(f"✓ {len(data['topics'])} topics, {len(cat_ids)} categories — all valid.")


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

    args = p.parse_args()
    data = load_data()

    dispatch = {
        "list": cmd_list, "search": cmd_search, "show": cmd_show,
        "categories": cmd_categories, "random": cmd_random, "validate": cmd_validate,
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
