# Sri Lankan Politics — Controversy Archive

A curated, **source-linked** archive of the most contested episodes in modern Sri Lankan
politics. Each entry is built to help you *explore what is disputed* — the mainstream
account, the competing narratives, the documented facts, and what remains unresolved or
under-reported — with links out to credible sources for your own verification.

It ships in two forms that read the **same dataset**:

- 🌐 **Web explorer** (`index.html`) — search, filter by category, sort by controversy,
  and open a full dossier for each topic in a modal, with clickable source links.
- ⌨️ **CLI explorer** (`cli.py`) — browse the archive from a terminal; zero dependencies,
  pure Python 3 standard library.

> **What "hidden truth" means here:** the *contested, disputed, or under-reported*
> dimensions of each episode — not conspiracy. Entries deliberately present multiple
> viewpoints. Sources are starting points; read them critically and consult primary
> documents where possible.

---

## Quick start

### Web UI

The page loads its data with `fetch()`, so it needs to be served over HTTP (opening the
file directly with `file://` will be blocked by the browser):

```bash
cd chatgpt
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

### CLI

```bash
python3 cli.py                       # overview + ranked list
python3 cli.py list                  # all topics, ranked by controversy
python3 cli.py list --category war   # filter by category id
python3 cli.py search "china"        # full-text search
python3 cli.py show easter           # full dossier (id or fuzzy title)
python3 cli.py categories            # list category ids + counts
python3 cli.py random                # surface a random controversy
python3 cli.py validate              # sanity-check the data file
python3 cli.py score [id]            # Evidence Strength score + breakdown
python3 cli.py rescore               # bake evidence scores into the data file
python3 cli.py linkcheck             # ping every source URL, report broken links
```

Add `--json` to `list`, `search`, `show`, `score`, `related`, or `linkcheck` for
machine-readable output you can pipe into other tools.

### Exploring how cases connect

Entries link to one another through typed `relatedTopics` edges and shared `actors`:

```bash
python3 cli.py related war-final-phase-2009   # links out, links in, and shared actors
python3 cli.py graph --format mermaid          # paste into any Mermaid renderer
python3 cli.py graph --format dot              # Graphviz: ... | dot -Tsvg > graph.svg
python3 cli.py graph --format json             # {nodes, edges} for D3/Cytoscape/etc.
```

In the web UI a **▦ Cards / ◍ Graph / ▤ Timeline** switcher offers the same data three
ways: the card grid, an interactive force-directed relationship graph (node size = number
of links, colour = category, hover to highlight neighbours, click to open), and a
chronological timeline. The active category filter applies to all three.

### Two independent scores

Every entry carries **two** scores that measure different things — never conflate them:

- **Controversy (0–10)** — how contested/heated the topic is.
- **Evidence Strength (0–100, graded A–F)** — how well-sourced and transparently cited
  *this entry* is. It is **not** a truth score.

`Evidence Strength` is computed deterministically from the data (source authority +
diversity + citation coverage + corroboration + balance) and the per-component breakdown
is always shown, so the number is itself auditable:

```bash
python3 cli.py score easter     # full breakdown bars for one topic
python3 cli.py score            # ranked table of all topics + grade distribution
```

The score is **baked into `topics.json`** (the `evidence` field) by `rescore` so the web UI
and CLI read identical numbers; re-run `rescore` after editing content. Entries whose
claims are still plain strings score low on coverage/corroboration by design — that gap is
exactly what per-claim citations close.

### Verifying source links

`linkcheck` fetches every unique source URL concurrently and sorts the results into three
buckets:

- **✓ ok** — resolved (HTTP < 400).
- **‼ blocked** — reachable but the host refuses automated clients (401/403/429/451). These
  are real pages behind a bot/rate-limit wall (e.g. some UN/OHCHR pages) — open them in a
  browser to confirm. They do **not** fail the run.
- **✗ broken** — genuinely dead (404, 5xx, DNS/TLS failure). Any broken link makes the
  command exit non-zero, so it doubles as a CI check.

```bash
python3 cli.py linkcheck --timeout 25 --workers 8   # tune network behaviour
python3 cli.py linkcheck --json > link-report.json  # machine-readable audit
```

It honours the standard `HTTPS_PROXY`/`SSL_CERT_FILE` environment so it works from behind
a corporate or sandbox proxy.

---

## What's in the archive

14 topics across 6 categories, including the final phase of the civil war and war-crimes
accountability, Black July 1983, the JVP insurrections, the 2019 Easter bombings, the
Central Bank bond scam, the Rajapaksa dynasty, the 2022 economic collapse and Aragalaya,
attacks on journalists, enforced disappearances, the 13th Amendment, the 2018
constitutional crisis, Hambantota and the "debt-trap" debate, the PTA, and the executive
presidency.

Each topic carries a **controversy score (0–10)** for ranking and an **Evidence Strength
grade (A–F)** for sourcing quality. **All 14 entries** are now enriched with per-claim
citations, perspective tags, key actors, and typed links to related cases, forming a
connected graph of 50 relationships.

---

## Project layout

```
chatgpt/
├── index.html          # web explorer markup
├── css/styles.css      # styling (dark, responsive)
├── js/app.js           # vanilla-JS explorer (search/filter/sort/modal)
├── archive/topics.json # the data — single source of truth for web + CLI
├── cli.py              # terminal explorer (stdlib only)
├── scoring.py          # deterministic Evidence Strength scorer (shared by CLI)
└── README.md
```

---

## Extending the archive

All content lives in `archive/topics.json`. To add a topic, append an object to the
`topics` array with these fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | unique slug, used in URLs and the CLI |
| `title` | string | |
| `category` | string | must match a `categories[].id` |
| `era` | string | free text; the first 4-digit year is used for chronological sort |
| `controversyScore` | number | 0–10 |
| `summary` | string | |
| `mainstreamAccount` | string | the commonly told version |
| `competingNarratives` | claim[] | the disputed / alternative accounts |
| `documentedFacts` | claim[] | points with broad evidentiary support |
| `stillContested` | string | what remains unresolved or under-reported |
| `sources` | source[] | see below; each `url` must start with `http` |
| `featured` | boolean | optional; pins the topic to the top as a "priority" entry |
| `actors` | string[] | optional; people/orgs/laws involved (searchable, shown as chips) |
| `relatedTopics` | relation[] | optional; typed links to other entries |
| `evidence` | object | generated by `rescore` — do not hand-edit |

A **claim** is either a plain string (legacy) or an object with inline citations:

```json
{ "text": "…", "sourceIds": ["wp-poe-report"], "perspective": "international" }
```

`documentedFacts` use `"evidence"` (e.g. `court-ruling`, `official-inquiry`) instead of
`"perspective"`. Each `sourceId` must match a source `id` on the same topic.

A **source** may be the legacy `{label, url}` or an enriched object:

```json
{ "id": "wp-poe-report", "label": "…", "url": "https://…",
  "type": "official-inquiry", "publisher": "United Nations",
  "date": "2011", "perspective": "international" }
```

A **relation** is `{ "id": "<topic id>", "relation": "led-to", "note": "…" }`. Valid
relations: `caused-by · led-to · part-of · same-actors · same-era · accountability-for ·
context-for · contradicts`.

After editing, run the validator, re-bake scores, and check links:

```bash
python3 cli.py validate     # structure: fields, ids, categories, citations, relations
python3 cli.py rescore      # recompute Evidence scores into topics.json
python3 cli.py linkcheck    # network: every source URL actually resolves
```

`validate` checks for missing fields, duplicate ids, unknown categories, out-of-range
scores, a well-typed `featured` flag, malformed source URLs, **unresolved citation
`sourceId`s, unknown source types, and dangling/`self`/mis-typed `relatedTopics`**.
`linkcheck` then confirms the URLs are live (see
[Verifying source links](#verifying-source-links)).

---

## Sourcing & editorial stance

- Sources lean on stable, widely accessible references (e.g. Wikipedia overview articles,
  UN/OHCHR reports, and human-rights organisations) chosen as **entry points** into each
  topic, not as the final word.
- Where facts are genuinely disputed (death tolls, intent, responsibility), the archive
  says so rather than picking a side.
- This is an **educational research aid**. It is not legal, historical, or journalistic
  authority — it is a map to help you read further.

Corrections and better primary sources are welcome — edit `topics.json` and re-validate.
