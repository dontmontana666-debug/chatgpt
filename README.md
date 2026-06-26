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
```

Add `--json` to `list`, `search`, or `show` for machine-readable output you can pipe
into other tools.

---

## What's in the archive

14 topics across 6 categories, including the final phase of the civil war and war-crimes
accountability, Black July 1983, the JVP insurrections, the 2019 Easter bombings, the
Central Bank bond scam, the Rajapaksa dynasty, the 2022 economic collapse and Aragalaya,
attacks on journalists, enforced disappearances, the 13th Amendment, the 2018
constitutional crisis, Hambantota and the "debt-trap" debate, the PTA, and the executive
presidency.

Each topic carries a **controversy score (0–10)** used for ranking and the visual meter.

---

## Project layout

```
chatgpt/
├── index.html          # web explorer markup
├── css/styles.css      # styling (dark, responsive)
├── js/app.js           # vanilla-JS explorer (search/filter/sort/modal)
├── archive/topics.json # the data — single source of truth for web + CLI
├── cli.py              # terminal explorer (stdlib only)
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
| `competingNarratives` | string[] | the disputed / alternative accounts |
| `documentedFacts` | string[] | points with broad evidentiary support |
| `stillContested` | string | what remains unresolved or under-reported |
| `sources` | `{label,url}[]` | each `url` must start with `http` |

After editing, run the validator:

```bash
python3 cli.py validate
```

It checks for missing fields, duplicate ids, unknown categories, out-of-range scores, and
malformed source URLs.

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
