# Field provenance and invariants

Every field in `src/tuf-spec-data.json`, where it comes from, and what the validator
and renderer require of it. **S** = scraped (must match upstream exactly),
**D** = derived (judgment, human-reviewed).

The authoritative schema is `src/types.ts`; the authoritative checks are
`src/data/validate.ts` (shape) and `scripts/validate-data.ts` (cross-references).
When this file and those disagree, they win.

## Contents

- [spec](#spec) — base TUF spec metadata and constraints
- [incorporatedTaps / processTaps](#incorporatedtaps--processtaps)
- [taps](#taps) — the toggleable set
- [tapInteractions](#tapinteractions)
- [implementations](#implementations)
- [Cross-cutting invariants](#cross-cutting-invariants)

## spec

From `theupdateframework/specification`, file `tuf-spec.md`.

| Field | | Source |
|---|---|---|
| `version` | S | `Text Macro: VERSION <x>` in the Bikeshed metadata block |
| `lastModified` | S | `Date:` in the metadata block (ISO `YYYY-MM-DD`) |
| `url` | S | Always the rendered latest spec: `https://theupdateframework.github.io/specification/latest/` |
| `editors[]` | S | `Editor: Name, Affiliation` lines, rewritten as `Name (Affiliation)` |
| `attacks[]` | S | Bullet list under `{#goals-to-protect-against-specific-attacks}`, with trailing `attack(s)` and punctuation stripped. Kept alphabetical |
| `roles{}` | D | Prose summary of the four top-level role sections. `description`, `keyPolicy`, `constraints[]` are editorial condensations, not quotes |
| `constraints{}` | D | The 13 base constraints. Derived by reading the spec, not extractable |

### spec.constraints

The map key is a snake_case slug; the `id` inside is what everything else references
and what renders. The two are independent — `keyid_computation` → `C-KEYID`.

| Field | | Notes |
|---|---|---|
| `id` | D | `C-` prefixed, uppercase. Referenced by TAP `constraintChanges[].constraintId` and interaction `constraintEffects[].constraintId` |
| `description` | D | The constraint as it stands in the *unmodified* spec. This is the text shown when no TAP touches it |
| `specSection` | S | A section anchor from `tuf-spec.md` (`{#file-formats-keys}` → `file-formats-keys`). The scraper verifies every one of these still exists — anchors get renamed across spec releases |
| `status` | — | Always the literal `"active"`; the validator allows nothing else |

Renaming a constraint `id` is a breaking change across the whole file: every TAP
change and interaction effect that references it must move with it.

## incorporatedTaps / processTaps

`incorporatedTaps[]` — TAPs the current major spec version has absorbed. The
authoritative list is the spec's `{#tuf-augmentation-proposal-tap-support}` section
(currently TAPs 6, 9, 10, 11); the scraper compares both directions.

| Field | | Notes |
|---|---|---|
| `tap`, `title` | S | From the TAP file header |
| `status` | S | Free-form string here, not the four-value enum — these carry the header's terminal status, normally `"Final"` |
| `summary` | D | One sentence. These render as static sidebar cards, so they get no analysis |

`processTaps[]` — TAPs governing the TAP process rather than the protocol (TAPs 1 and
2). `tap`, `title` scraped; `notes` a one-line editorial gloss. TAP 2 is the
submission template, so its upstream header carries placeholder values — the scraper
skips it.

Neither array is toggleable, so neither carries constraint changes. Their TAP numbers
*do* count as satisfied dependencies: `checkDependencyWarnings` in
`src/data/selectors.ts` treats incorporated TAPs as always-present, which is why
TAP 17 depending on TAP 11 raises no warning.

## taps

The toggleable set — from `theupdateframework/taps`, one `tapN.md` per TAP.

| Field | | Notes |
|---|---|---|
| `tap` | S | Integer, unique across all three arrays |
| `title` | S | `Title:` header, sentence case as upstream writes it |
| `status` | S | `Accepted` \| `Draft` \| `Rejected` \| `Deferred`. The README's `## Status` grouping is authoritative; the file header can lag. A header reading `Final`/`Superseded`/`Withdrawn` means the TAP no longer belongs here |
| `url` | S | Canonical blob URL `https://github.com/theupdateframework/taps/blob/master/tapN.md`. A PR URL means the TAP had not merged when the entry was written — replace it once the file exists on master |
| `summary` | D | One or two sentences, present tense, describing what the TAP changes. Renders on the sidebar card |
| `dependencies[]` | D | TAP numbers this TAP requires. May reference incorporated TAPs |
| `requiresMajorBump` | D | Whether adoption forces spec 2.x — true when the TAP breaks metadata compatibility for existing clients |
| `constraintChanges[]` | D | See below |
| `incompatibilities[]` | D | Optional. `{ description, severity: breaking \| warning }` |
| `securityImpact` | D | `{ mitigates[], description }`. Every `mitigates` string should be an exact member of `spec.attacks[]` — the renderer matches them to the spec's attack list |

### taps[].constraintChanges

How `computeConstraints` in `src/data/selectors.ts` consumes each entry — get this
wrong and the UI shows empty or misleading constraint text:

| `type` | On an existing base constraint | On an unknown `constraintId` |
|---|---|---|
| `relaxed` | status → `modified`, description replaced by `after` | creates a new constraint, description from `description` ?? `after` |
| `removed` | status → `removed`, description replaced by `after` | creates a new constraint |
| `added` | recorded as a change, base status unchanged | creates a new constraint, status `new` |

Consequences worth internalising:

- For `relaxed`/`removed` against a base constraint, **`after` is what renders**. Omit
  it and the card silently keeps showing the unmodified spec text. Supply `before` too
  — it should quote the base constraint's current `description` so the diff reads
  cleanly.
- For an `added` constraint (a `constraintId` not in `spec.constraints`),
  **`description` is what renders**. It is technically optional in the schema but
  effectively required here, or the card renders blank.
- `detail` is required on every change and holds the mechanical specifics — new
  metadata fields, format changes. It renders as the sub-line under the change.
- New constraint IDs follow the base convention: `C-` prefix, uppercase, hyphenated
  (`C-AND-DELEG`, `C-SUCCINCT`, `C-MLDSA-PREHASH`). Two TAPs may introduce the same
  new ID; the selector merges their changes onto one card.
- `incompatibilities[]` needs no constraint ID — the selector synthesises
  `INCOMPAT-TAP<n>` and renders it as an `incompatible` card.

## tapInteractions

Pure derived analysis — nothing upstream describes these. 42 entries currently:
11 synergies, 20 tensions, 2 conflicts, 9 compounds.

| Field | Notes |
|---|---|
| `taps[]` | 2–4 TAP numbers. **Must all be in `taps[]`** — never an incorporated or process TAP; `validate-data` rejects that. An interaction fires only when *every* listed TAP is active, so adding a TAP narrows when it shows |
| `type` | `synergy` (reinforcing) \| `tension` (friction, still workable) \| `conflict` (mutually incompatible) \| `compound` (emergent, 3+ TAPs) |
| `severity` | `info` \| `warning` \| `breaking`. Drives the card colour. Conflicts are normally `breaking` |
| `title` | Short and concrete — it is the card headline |
| `description` | The mechanism: what each TAP does, and what specifically happens when both apply. Vague pairings ("these interact") are worse than no entry |
| `constraintEffects[]` | Optional `{ type, constraintId, description }`. Applied *after* individual TAP changes, so an interaction can override a status an individual TAP set. `description` doubles as the `detail` line |

## implementations

TUF client libraries. Repo metadata is checkable; the support matrix is evidence work.

| Field | | Notes |
|---|---|---|
| `id` | — | Stable kebab-case slug, used as the React key |
| `name`, `language` | S | From the repo |
| `githubUrl` | S | Must be http(s); the validator parses it |
| `status` | S | `active` \| `pre-production` \| `alpha` \| `archived`. Judge from release cadence and the repo's own README wording |
| `tier` | D | `core` (theupdateframework org) \| `third-party` \| `sigstore` \| `system` (end-user systems: Notary, TUF-on-CI, RSTUF, Uptane, TAF). Drives UI grouping |
| `specVersion` | S | Targeted TUF spec version, or `custom` / `pre-1.0` where a library predates or diverges from 1.0 |
| `conformancePercent` | S | Optional. Only set with a citable source (`theupdateframework/tuf-conformance` results). Omit rather than estimate |
| `tapSupport[]` | D | `{ tap, level: full \| partial, notes? }`. Evidence-based — see `deriving-analysis.md` |
| `notes` | D | Optional one-liner |

`tapSupport` drives two renderer outputs: per-card green/red ticks against the active
TAPs, and the summary bar's "N implementations fully cover this combination". Note
that `computeImplementationCoverage` only checks *presence* of a `tapSupport` entry —
a `partial` entry counts as supported for coverage, with the level shown on the card.
So `partial` is the honest choice for incomplete support, not an exclusion.

**`tapSupport[].notes` is data-only and never rendered.** `ImplementationCard.tsx`
renders only the top-level `impl.notes`. The per-TAP note is still the right place to
record a precise deviation for future audits, but anything a reader needs in order to
interpret the card has to reach `impl.notes` as well. This is genuinely surprising, and
it is why a caveat can look recorded while being invisible.

## Cross-cutting invariants

`scripts/validate-data.ts` enforces these; the scraper checks the ones involving
upstream:

1. TAP numbers are unique across `taps[]`, `incorporatedTaps[]`, `processTaps[]`, and
   every upstream `tapN.md` maps to exactly one of them.
2. `taps[].dependencies[]` reference TAPs in `taps[]` or `incorporatedTaps[]`.
3. `tapInteractions[].taps[]` reference `taps[]` only.
4. `implementations[].tapSupport[].tap` reference TAPs in `taps[]` or
   `incorporatedTaps[]`.
5. Every `constraintId` in a TAP change or interaction effect either exists in
   `spec.constraints` or is introduced by some TAP's `constraintChanges`. Dangling IDs
   render as orphan cards.
6. Every `spec.constraints[].specSection` is a live section anchor in `tuf-spec.md`.
7. `taps[].url` and `implementations[].githubUrl` are http(s) URLs.
8. `securityImpact.mitigates[]` strings match `spec.attacks[]` members.
