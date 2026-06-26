#!/usr/bin/env python3
"""
Evidence Strength scoring for the Controversy Archive.

This is NOT a "truth score". It measures how well-evidenced and transparently
sourced a *given archive entry* is — independently of how controversial the
topic is. The score is computed deterministically and offline from topics.json
alone, and the per-component breakdown is always exposed, so the number is
itself auditable rather than another opaque authority claim.

Components (0–100):
    authority      30   tier of the sources + the evidence kinds the facts rest on
    diversity      20   distinct source/evidence types and distinct perspectives
    citationCoverage 25 share of claims (narratives + facts) that cite a source
    corroboration  15   share of documented facts backed by >= 2 sources
    balance        10   has all sides (mainstream + competing + facts + open
                        questions) and >= 2 distinct narrative perspectives

Legacy entries whose claims are plain strings (no inline citations) score low
on coverage/corroboration by design — that gap is exactly what enrichment closes.
"""

# Quality value (0..1) for each source type / evidence kind. Higher = stronger.
TIERS = {
    "court-ruling": 1.00,
    "primary-doc": 0.95,
    "official-inquiry": 0.95,
    "un-official": 0.90,
    "official-record": 0.85,
    "academic": 0.80,
    "investigative-journalism": 0.75,
    "ngo": 0.70,
    "news": 0.60,
    "testimony": 0.50,
    "encyclopedia": 0.45,
    "unknown": 0.30,
}

WEIGHTS = {
    "authority": 30,
    "diversity": 20,
    "citationCoverage": 25,
    "corroboration": 15,
    "balance": 10,
}

GRADE_BANDS = [(80, "A"), (65, "B"), (50, "C"), (35, "D"), (0, "F")]


# ---- claim / source accessors (tolerate legacy strings) --------------------
def claim_text(c):
    return c if isinstance(c, str) else c.get("text", "")


def claim_source_ids(c):
    return [] if isinstance(c, str) else list(c.get("sourceIds", []))


def claim_perspective(c):
    return None if isinstance(c, str) else c.get("perspective")


def claim_evidence(c):
    return None if isinstance(c, str) else c.get("evidence")


def infer_source_type(src):
    """Derive a type for legacy sources lacking an explicit `type`."""
    if isinstance(src, dict) and src.get("type"):
        return src["type"]
    url = (src.get("url", "") if isinstance(src, dict) else "").lower()
    if "ohchr.org" in url or "un.org" in url:
        return "un-official"
    if "amnesty.org" in url or "hrw.org" in url:
        return "ngo"
    if "wikipedia.org" in url:
        return "encyclopedia"
    return "unknown"


def _q(kind):
    return TIERS.get(kind, TIERS["unknown"])


# ---- the score -------------------------------------------------------------
def evidence_score(topic):
    sources = topic.get("sources", []) or []
    narratives = topic.get("competingNarratives", []) or []
    facts = topic.get("documentedFacts", []) or []
    claims = list(narratives) + list(facts)

    source_types = [infer_source_type(s) for s in sources]
    fact_evidence = [claim_evidence(f) for f in facts if claim_evidence(f)]

    # authority: best source/evidence quality (0.6) blended with the mean (0.4)
    pool = [_q(t) for t in source_types] + [_q(e) for e in fact_evidence]
    if pool:
        authority_frac = 0.6 * max(pool) + 0.4 * (sum(pool) / len(pool))
    else:
        authority_frac = 0.0

    # diversity: distinct kinds + distinct perspectives
    kinds = set(source_types) | set(fact_evidence)
    perspectives = {s.get("perspective") for s in sources if isinstance(s, dict) and s.get("perspective")}
    perspectives |= {claim_perspective(n) for n in narratives if claim_perspective(n)}
    d_kinds = min(1.0, len(kinds) / 3.0)
    d_persp = min(1.0, len(perspectives) / 3.0) if perspectives else 0.0
    diversity_frac = 0.5 * d_kinds + 0.5 * d_persp

    # citation coverage: share of claims that cite >= 1 source
    cited = sum(1 for c in claims if claim_source_ids(c))
    coverage_frac = cited / len(claims) if claims else 0.0

    # corroboration: share of facts backed by >= 2 distinct sources
    corro = sum(1 for f in facts if len(set(claim_source_ids(f))) >= 2)
    corro_frac = corro / len(facts) if facts else 0.0

    # balance: represents all sides + multiple narrative perspectives
    narr_persp = {claim_perspective(n) for n in narratives if claim_perspective(n)}
    balance_items = [
        bool(topic.get("mainstreamAccount")),
        len(narratives) >= 1,
        len(facts) >= 1,
        bool(topic.get("stillContested")),
        len(narr_persp) >= 2,
    ]
    balance_frac = sum(balance_items) / len(balance_items)

    fracs = {
        "authority": authority_frac,
        "diversity": diversity_frac,
        "citationCoverage": coverage_frac,
        "corroboration": corro_frac,
        "balance": balance_frac,
    }
    components = {k: round(WEIGHTS[k] * v, 1) for k, v in fracs.items()}
    total = round(sum(components.values()))
    grade = next(g for cut, g in GRADE_BANDS if total >= cut)

    return {
        "score": total,
        "grade": grade,
        "components": components,
        "maxComponents": dict(WEIGHTS),
        "enriched": any(not isinstance(c, str) for c in claims),
    }


if __name__ == "__main__":
    import json, os, sys
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "archive", "topics.json")
    data = json.load(open(path, encoding="utf-8"))
    for t in data["topics"]:
        r = evidence_score(t)
        print(f"{r['grade']}  {r['score']:>3}  {t['id']}")
