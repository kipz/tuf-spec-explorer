---
name: refresh-tuf-data
description: Scrape upstream TUF sources (the TAP repository, the TUF specification, and TUF client library repos) to refresh src/tuf-spec-data.json, the single file that populates the TUF TAP Explorer renderer. Use this skill whenever the user wants to update, refresh, re-scrape, regenerate, audit, or check the freshness of the explorer's data — including when they mention a new TAP, a TAP whose status changed, a new spec version, adding or updating a TUF implementation, changing which TAPs an implementation supports, adding TAP interactions, or just ask "is the data still current?" or "has anything changed upstream?". Also use it when the user reports that the app shows a stale spec version, a missing TAP, a wrong TAP status, or a dead TAP link.
---

# Refresh the TUF Explorer data

`src/tuf-spec-data.json` is the only data source the renderer reads. Everything on
screen — the TAP sidebar, resolved constraints, interaction cards, security impact,
implementation coverage — is computed from it by `src/data/selectors.ts`. Refreshing
it correctly is therefore the whole job: get the upstream facts right, keep the
derived analysis honest, and leave the file passing `npm run validate-data`.

The file mixes two very different kinds of content, and treating them the same way
is the main way this task goes wrong:

- **Scraped facts** — TAP numbers, titles, statuses, URLs, spec version and date,
  editors, the spec's attack list, which TAPs the spec has incorporated. These are
  mechanically extractable and should always match upstream exactly.
- **Reviewed analysis** — `constraintChanges`, `dependencies`, `requiresMajorBump`,
  `securityImpact`, `incompatibilities`, `tapInteractions`, and each
  implementation's `tapSupport`. These were derived by reading TAP bodies and
  library source, then reviewed against the sources by a human. There is nothing
  upstream to copy them from.

So the default posture is **incremental**: correct the scraped facts, and re-derive
analysis only where the underlying source actually moved. Rewriting reviewed
analysis that nothing upstream changed destroys work and cannot be checked.

## Workflow

### 1. Find the drift

```bash
python3 .claude/skills/refresh-tuf-data/scripts/scrape_sources.py
```

The script shallow-clones (or fast-forwards) the TAP, specification and
tuf-conformance repos into `.claude/skills/refresh-tuf-data/.cache/`, extracts the
scrapeable facts, and prints a drift report in five groups: base spec, TAP inventory,
TAP bodies, implementations and repo docs. It writes the parsed upstream facts to
`.cache/out/upstream.json` and the report to `.cache/out/drift.json`.

Two of its checks are worth knowing about because they answer questions that otherwise
need judgment. It diffs `tuf-spec.md` **section by section** between the version the
data records and current master, and tells you specifically whether a section a base
constraint cites has moved — so a version bump stops being an open worry about whether
the constraint text is still right. And it cross-checks `implementations[]` against the
client list upstream actually conformance-tests, catching both a tested client missing
from the data and one whose `conformancePercent` was never recorded.

The report ends with a "Not checked" section. Read it — it is the accurate statement of
what a clean report does and does not prove.

Useful flags: `--offline` reuses the cached clones, `--data`/`--readme` point at
different files, and `--json` emits the report only.

`--write-provenance` records the current TAP body hashes to
`.claude/skills/refresh-tuf-data/provenance.json` so the *next* run can tell you which
TAP bodies moved. Timing matters: that file asserts "the analysis in the data file
reflects these TAP revisions", so write it **after** you finish a refresh, never at the
start. Writing it up front stamps unreviewed analysis as verified and permanently hides
the drift. It belongs in git — committing it is what gives every clone the same
baseline.

Pass `--provenance-note` describing what you actually verified, and be honest about
what you did not. A bare hash record implies every derived field was re-derived; the
note is what stops the next reader believing that.

Read the report before touching anything. It tells you which of the following
sections you actually need.

### 2. Fix the scraped facts

Everything in the `spec` and `taps` sections of the report is a direct correction —
take the upstream value from `.cache/out/upstream.json` and write it into the data
file. No judgment needed. Watch for two cases that mean more than a field edit:

- **A TAP exists upstream but is in none of the three arrays.** It has to be
  classified: `processTaps[]` if it governs the TAP process itself (TAPs 1 and 2),
  `incorporatedTaps[]` if the spec's TAP-support section lists it, otherwise
  `taps[]` — which means deriving its analysis (step 3).
- **A toggleable TAP's header status reached `Final`.** The spec has probably folded
  it in. Confirm against the spec's TAP-support section, then move it to
  `incorporatedTaps[]` and delete its `constraintChanges` — a constraint the spec
  now mandates is a base constraint, not a toggleable change. That usually means
  adding it to `spec.constraints` and re-pointing anything that referenced it.

### 3. Re-derive analysis only where the source moved

Read `references/deriving-analysis.md` before deriving any of it. It covers each
derived field, what evidence in a TAP body supports it, and the traps — how
`before`/`after`/`description` feed the renderer, why interaction `taps[]` may only
reference toggleable TAPs, and how to gather implementation `tapSupport` evidence
with `gh search code` rather than guessing.

Derive when: a TAP is new to `taps[]`, the report says its body changed, or the user
explicitly asked for that part (a new implementation, new interactions). Otherwise
leave it alone.

### 4. Validate

```bash
npm run validate-data && npm run typecheck && npm test && npm run lint
```

`validate-data` runs the same schema validator the app uses at load time
(`src/data/validate.ts`) plus cross-reference checks: TAP dependencies and
implementation `tapSupport` must reference TAPs that exist, interaction `taps[]` must
reference toggleable TAPs, and every `constraintId` must resolve. A failure here is a
real inconsistency, not a lint nit — fix the data rather than loosening the check.

If you added or removed a TAP, an implementation, an interaction or a base
constraint, `src/data/selectors.test.ts` and `src/data/validate.test.ts` may assert
on counts. Update assertions that encode the old totals; don't weaken tests that
check behaviour.

### 5. Update the docs the data contradicts

The report's `docs` section catches this. `README.md` quotes counts in prose ("15
TAPs", "42 interactions", "18 TUF client libraries", "13 base spec constraints", the
synergy/tension/conflict breakdown), mentions the spec version in prose, and lists
every TAP and implementation URL in its appendix — each with a hand-written label.
Those all rot silently, and a wrong appendix label is the worst of them because it
teaches a reader the wrong subject for a TAP with nothing to contradict it. The script
compares each label against the upstream title, so fix whatever it flags.

### 5a. If you changed the script, run its tests

```bash
npm run test:skill
```

`scripts/test_scrape_sources.py` covers the parsers, the drift checks and the cache
safety guards, and it runs in CI. It is weighted towards failure behaviour on purpose:
this script's recurring bug has been skipping a comparison when an extraction came
back empty and then reporting the field clean, which is invisible and points the wrong
way. If you add a check, add the malformed-input case too — and keep the tests offline,
using a local bare repo where you need a real fetch.

### 6. Report back

Tell the user what moved, in three buckets: facts corrected, analysis re-derived
(and on what evidence), and anything you deliberately left alone. Be explicit about
the last one — "TAP 16's body changed but I only refreshed its title" is exactly the
sort of thing they need to know to review it. If you could not find evidence for
something, say so rather than filling the field with a plausible guess; a wrong
`tapSupport` entry is worse than an absent one because it renders as a confident
green tick.

## Field provenance

`references/data-model.md` has the field-by-field breakdown: every field in the data
file, where it comes from, whether it is scraped or derived, and the invariants the
validator enforces. Read it when you are unsure whether a field is yours to change,
or what shape a new entry needs.

## Scope control: narrow edits, wide reporting

These are two different budgets and conflating them produces bad work in both
directions.

**Edit scope stays where the user put it.** If they asked something narrow ("did TAP 21
land?", "add sigstore-python"), change that and don't quietly widen the diff. A full
refresh across all four areas is a lot of work, and the implementation matrix is the
expensive part — 17 repositories.

**Reporting scope should be as wide as you can make it.** Anything you notice is worth
saying even when you don't act on it, and an audit request is a request for findings,
so hunting beyond the script is the job rather than a distraction. Concretely, the
script's report is a floor, not a ceiling — it checks a fixed set of fields and prints
what it cannot see. When someone asks what's stale, go past it: check the conformance
report for figures the data lacks, look for TUF clients missing from `implementations[]`
entirely, and read the sections the spec section-diff flags.

If they asked for a full refresh, work through the areas in order — spec facts, TAP
inventory, TAP analysis, interactions, implementations. Later areas reference earlier
ones, so doing it backwards means redoing work.

A clean drift report means "these particular checks passed", never "the data is
current". Say which of the two you actually established.
