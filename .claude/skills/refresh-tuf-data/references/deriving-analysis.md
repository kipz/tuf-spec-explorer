# Deriving the analysis fields

The scraped facts have one right answer. These fields don't — they are readings of
source material, and the file's value rests on those readings being defensible. The
standard to hold yourself to: **every derived claim should be traceable to something
you actually read.** When you can't get there, leave the field out and say so. An
absent `tapSupport` entry renders as "not supported", which is recoverable; a wrong
one renders as a confident green tick that nobody will re-check.

## Reading a TAP body

TAP documents follow a loose but consistent shape: header block, `# Abstract`,
`# Motivation`, `# Rationale`, `# Specification`, `# Security Analysis`,
`# Backwards Compatibility`. The last three carry almost everything you need.

Work from the cached clone the scraper made — `.cache/taps/tapN.md` — rather than
fetching, so you are reading the same revision the drift report was computed against.

**`summary`** — compress the Abstract to one or two present-tense sentences saying
what changes, not why it was proposed. The sidebar card is narrow; front-load the
mechanism.

**`dependencies[]`** — the Specification and Motivation sections say this outright
("this TAP builds on TAP 8", "requires the POUF mechanism of TAP 11"). Only record a
genuine prerequisite: a TAP that cannot be implemented without the other. Thematic
similarity is not a dependency — that's an interaction. Incorporated TAPs are legal
dependencies and never raise a warning, so recording TAP 11 as a dependency is
accurate and harmless.

**`requiresMajorBump`** — read `# Backwards Compatibility`. True when an
already-conforming client would reject metadata produced under the TAP, or a
conforming producer would emit metadata an old client can't parse. Phrases like
"backwards-incompatible", "clients must be updated", or a new required metadata field
are the tell. Additive-and-optional changes, and changes confined to the repository
side, are false. TAPs 3, 8, 15, 16 and 20 are true; use them as calibration.

**`constraintChanges[]`** — the real work. For each base constraint in
`spec.constraints`, ask whether this TAP touches it:

- It replaces the rule → `relaxed`, with `before` quoting the base constraint's
  current `description` and `after` stating the new rule.
- It deletes the rule outright → `removed`, with `after` describing what holds
  instead.
- It adds a rule the spec has no constraint for → `added` with a **new**
  `constraintId`, and `description` carrying the new rule. This is the case where
  omitting `description` silently renders a blank card.

`detail` always carries the mechanical specifics: the new metadata fields, the format
changes, the parameter names. Quote actual field names from the Specification section
(`min_roles_in_agreement`, `succinct_roles`, `keys_for_delegations`) — they are what
makes the entry checkable later.

Two failure modes to avoid. Inventing a new constraint ID for something an existing
base constraint already covers fragments the UI, so check the 13 base constraints
first. And writing `after` text that restates `before` in different words means the
diff renders as noise — if a TAP doesn't actually change a constraint, it gets no
entry for it.

**`securityImpact`** — from `# Security Analysis`. `mitigates[]` must use exact
strings from `spec.attacks[]`; the renderer matches them against the spec's list, so
"Rollback attacks" instead of `"Rollback"` silently fails to match. If a TAP hardens
something outside the spec's ten named attacks, describe it in `description` and
leave `mitigates` empty rather than inventing an attack name.

**`incompatibilities[]`** — only where the TAP names a concrete break. `breaking` for
"existing clients will reject this", `warning` for "operators must migrate carefully".

## Deriving interactions

Nothing upstream describes these; they exist because the explorer's whole point is
showing what happens when you toggle several TAPs at once. A good interaction entry
survives the question *"what specifically goes wrong, or gets better, that wouldn't
if only one of these were active?"*

Method that works: for each candidate pair, list the constraints each TAP touches. An
overlap in constraint IDs is the strongest signal — two TAPs rewriting `C-DELEG` are
either synergistic or in conflict, never independent. Non-overlapping TAPs can still
interact when one's mechanism flows into the other's (a rotation cascading into
cross-repo consensus), and that's where the interesting compounds live.

Choosing the type:

- **synergy** — combining them yields a property neither has alone. Usually `info`.
- **tension** — both work, but the combination costs something: coordination burden,
  weakened guarantee, an operational sharp edge. Usually `warning`. This is the
  largest category because most TAP pairs are workable-but-awkward, and that is
  genuinely the most useful thing to tell a reader.
- **conflict** — they cannot both be adopted as specified. `breaking`. Rare, and the
  bar is high: name the specific incompatibility, not a difficulty.
- **compound** — 3+ TAPs producing emergent behaviour that no pair among them
  explains. If the effect is really just one of the pairs, make it a pair.

Remember an interaction only renders when *every* TAP in `taps[]` is active. Listing a
fourth TAP because it's tangentially involved makes the card nearly unreachable.
Prefer the smallest set that produces the effect.

Use `constraintEffects[]` when the combination changes a constraint in a way neither
TAP does alone. Effects apply after individual TAP changes and can override the
status one TAP set — that ordering is deliberate, so a synergy may legitimately
`removed` a constraint an individual TAP only `relaxed`.

## Deriving implementation support

The expensive one. For each library, the question per TAP is: is there evidence in the
repository that this TAP's mechanism is implemented?

Use `gh` — the repos are all public, so switch to the open-source account first
(this repo's convention):

```bash
gh auth switch --user kipz
gh search code --repo theupdateframework/python-tuf 'succinct_roles' --limit 5 --json path
```

Search for the TAP's distinctive metadata field or mechanism name rather than "TAP
15", since implementations rarely cite TAP numbers in code. Starting markers — treat
them as leads to confirm by reading the hits, not as answers:

| TAP | Search for |
|---|---|
| 3 Multi-role delegations | `min_roles_in_agreement`, `keys_for_delegations`, `roleinfo` |
| 4 Multi-repository consensus | `map.json`, `multirepo`, `TrustedMetadata` + repository map |
| 5 Role URLs in root | `role url`, root metadata `uris` |
| 8 Key rotation / self-revocation | `rotate` metadata file, `rotation` handling in root updates |
| 12 Keyid flexibility | `keyid_hash_algorithms`, keyid computation from the key's scheme |
| 13 Mapping metadata | `mapping`, top-level target selection |
| 15 Succinct hashed bin delegations | `succinct_roles`, `SuccinctRoles`, `bit_length`, `name_prefix` |
| 16 Snapshot Merkle trees | `merkle`, `snapshot merkle` |
| 17 Remove signature wrapper | `dsse`, `DSSE`, `envelope` |
| 18 Sigstore/Fulcio identities | `fulcio`, `sigstore` identity verification in TUF metadata |
| 19 Content addressable targets | content-addressed target paths, digest-addressed fetch |
| 20 Self-revocation | null-key revocation, self-revoke |
| 21 ML-DSA | `ml_dsa`, `mldsa`, `ML-DSA`, FIPS 204 |

Finding the mechanism is only half the job. The question is not "does this symbol
exist?" but "does the implemented behaviour match what the TAP specifies?" — so after
locating the code, **read the TAP's normative section and compare it against what the
code actually does.** Presence is not conformance, and skipping this step is the main
way this field ends up wrong.

Grading the evidence:

- **`full`** — implemented in library code, exercised by tests, **and** behaving as the
  TAP specifies in the cases the TAP is explicit about.
- **`partial`** — the mechanism is there but deviates or is incomplete: behind a flag,
  experimental, one direction only (consuming but not producing), or implemented with
  semantics the TAP defines differently.
- **no entry** — no evidence found. A legitimate and common answer: most cells in this
  matrix are genuinely empty, and 12 of the 17 libraries currently list no TAP support.

### Worked example: python-tuf and TAP 15

The trap, using a real case that was wrong in the shipped data.

Searching `succinct_roles` in python-tuf finds everything you'd want: a `SuccinctRoles`
class in `tuf/api/_payload.py` with `bit_length` and `name_prefix`, client-side
resolution through `Delegations.get_roles_for_target`, `ngclient` driving it during
target lookup, five test files, and a repository-side example. On a presence test that
is unambiguously `full`.

Reading tap15.md alongside it changes the answer. The TAP says:

> All succinct hashed bin delegations will be non-terminating. If a user would like
> succinct delegations to be terminating, they may add the terminating flag in either
> the parent delegation or in the individual bins.

python-tuf hardcodes the opposite, and says so in a comment:

```python
elif self.succinct_roles is not None:
    # We consider all succinct_roles as terminating.
    # For more information read TAP 15.
    yield self.succinct_roles.get_role_for_target(target_filepath), True
```

That is a behavioural difference with consequences — a repository relying on
non-terminating bins so lookups fall through to later delegations won't get that
fall-through. python-tuf's own `Delegations` docstring goes further, noting that
setting `succinct_roles` produces metadata spec-compliant clients reject. So the
honest level is `partial`, and the deviation is the whole point of the entry.

Note what the comment did to a careless reading: it cites TAP 15, which *looks* like
confirmation. A citation is not agreement — check what the TAP actually requires.

### Where the qualifier goes

`tapSupport[].notes` is **not rendered anywhere** — `ImplementationCard.tsx` renders
only the top-level `impl.notes`. So a caveat left solely in the per-TAP note is
invisible to readers.

Record both: the precise deviation in `tapSupport[].notes`, because that is where a
future audit will look for it, and a short version in the implementation's `impl.notes`
if a reader needs it to interpret the card. The existing "DSSE experimental" note is
the right shape for the former, but on its own it never reaches the screen.

Hits in docs, changelogs or issues are worth following but are not implementation
evidence on their own; a test or a `.feature` file is. When the only hit is a doc
mention, either read further to confirm the code exists or record nothing.

Finally, a deviation found in one library often applies to its dependents. RSTUF is
built on python-tuf, so it inherits python-tuf's TAP 15 behaviour — when you correct a
level, check who else wraps that library before assuming the fix is local.

`conformancePercent` comes from `theupdateframework/tuf-conformance` results, not from
inference. If you can't cite a figure, omit the field — an omitted value renders as
absent, while a guessed one renders as a hard number.

When adding a whole new implementation, also add its repo URL to `README.md`'s
appendix source list; the scraper's `docs` check will flag it if you forget.

## Recording what you did

The README appendix states plainly that this analysis was LLM-derived from the listed
sources and then reviewed. Keep that true: when you re-derive something, note in your
report which TAP revision you read (the scraper prints the `taps` commit) and what
evidence backed each non-obvious call, so a human review has something to check
against.
