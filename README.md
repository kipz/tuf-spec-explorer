# TUF TAP Explorer

An interactive single-page application for exploring how [TUF Augmentation Proposals (TAPs)](https://github.com/theupdateframework/taps) modify the constraints defined by [The Update Framework (TUF) specification](https://theupdateframework.github.io/specification/latest/).

Toggle any combination of 20 TAPs and see how the spec constraints change, which TAPs interact (synergies, tensions, conflicts), dependency warnings, and security impacts — all computed in real time.

## Building and Running Locally

**Prerequisites:** Node.js (v18+) and npm.

```bash
# Install dependencies
npm install

# Start the dev server (with hot reload)
npm run dev

# Or build for production
npm run build

# Preview the production build
npm run preview
```

The dev server runs at `http://localhost:5173` by default.

## Tech Stack

- **React 19** with TypeScript 5.7
- **Vite 6** for bundling and dev server
- Plain CSS with custom properties for theming

---

## Appendix: Data Model

All TAP and constraint data lives in [`src/tuf-spec-data.json`](src/tuf-spec-data.json). The TypeScript interfaces are defined in [`src/types.ts`](src/types.ts).

### Top-Level Structure

```
SpecData
├── spec              # Base TUF spec metadata (v1.0.34)
│   ├── roles         # root, targets, snapshot, timestamp
│   ├── attacks[]     # Attacks TUF mitigates
│   └── constraints{} # 12 base spec constraints (C-KEYID, C-DELEG, etc.)
├── incorporatedTaps  # TAPs already merged into the spec (6, 9, 10, 11)
├── taps[]            # 20 TAPs with constraint changes and security impacts
├── tapInteractions[] # 43 cross-TAP interactions (synergies, tensions, conflicts, compounds)
└── processTaps[]     # Process-oriented TAPs (1, 2) not modeled as constraint changes
```

### Key Entities

**Tap** — A single TAP with its status, dependencies, constraint changes, and security impact.

| Field | Description |
|---|---|
| `tap` | TAP number |
| `status` | `Accepted`, `Draft`, `Rejected`, `Deferred`, or `Final` |
| `dependencies` | TAP numbers this TAP depends on |
| `requiresMajorBump` | Whether adoption requires a spec v2.x |
| `constraintChanges[]` | How this TAP adds, removes, or relaxes constraints |
| `securityImpact` | What attacks are mitigated and how |

**Constraint** — A base TUF spec constraint (e.g. `C-DELEG`, `C-THRESH`).

| Field | Description |
|---|---|
| `id` | Identifier like `C-KEYID` |
| `description` | Full constraint text |
| `specSection` | Section in the TUF spec (e.g. `4.2`) |

**ConstraintChange** — How a TAP modifies a constraint.

| Field | Description |
|---|---|
| `type` | `added`, `removed`, or `relaxed` |
| `constraintId` | Which constraint is affected |
| `before` / `after` | The constraint text before and after the change |

**TapInteraction** — An emergent effect when two or more TAPs are active together.

| Field | Description |
|---|---|
| `taps` | Array of 2–4 TAP numbers involved |
| `type` | `synergy`, `tension`, `conflict`, or `compound` |
| `severity` | `info`, `warning`, or `breaking` |
| `constraintEffects[]` | Additional constraint changes caused by the interaction |

There are 43 interactions total: 12 synergies, 23 tensions, 5 conflicts, and 3 compound effects. Compound effects involve 3+ TAPs and capture emergent behaviour (e.g. the "AND-delegation ratchet" from TAPs 3+8+20).

### Constraint Resolution

When TAPs are toggled in the UI, constraints are resolved as follows:

1. Start with the 12 base spec constraints (all `unchanged`).
2. Apply each active TAP's `constraintChanges` — status becomes `modified`, `removed`, or `new`.
3. Apply any `constraintEffects` from active interactions.
4. Flag dependency violations and incompatibilities.

### Resources Used to Generate the Data Model

The data model was constructed by analyzing the following primary sources:

- [TUF Specification v1.0.34](https://theupdateframework.github.io/specification/latest/) — the base constraints and role definitions
- [TAP repository](https://github.com/theupdateframework/taps) — individual TAP documents:
  - [TAP 3](https://github.com/theupdateframework/taps/blob/master/tap3.md) — Multi-role Delegations
  - [TAP 4](https://github.com/theupdateframework/taps/blob/master/tap4.md) — Multiple Repository Consensus
  - [TAP 5](https://github.com/theupdateframework/taps/blob/master/tap5.md) — Setting URLs for Roles on Repositories
  - [TAP 7](https://github.com/theupdateframework/taps/blob/master/tap7.md) — Conformance Testing
  - [TAP 8](https://github.com/theupdateframework/taps/blob/master/tap8.md) — Key Rotation via Root
  - [TAP 12](https://github.com/theupdateframework/taps/blob/master/tap12.md) — Improving Delegation
  - [TAP 13](https://github.com/theupdateframework/taps/blob/master/tap13.md) — User Selection of Top-Level Targets
  - [TAP 14](https://github.com/theupdateframework/taps/blob/master/tap14.md) — Managing TUF Versions
  - [TAP 15](https://github.com/theupdateframework/taps/blob/master/tap15.md) — Succinct Hashed Bin Delegations
  - [TAP 16](https://github.com/theupdateframework/taps/blob/master/tap16.md) — Snapshot Merkle Trees
  - [TAP 17](https://github.com/theupdateframework/taps/blob/master/tap17.md) — Remove Target Paths from Snapshot
  - [TAP 18](https://github.com/theupdateframework/taps/blob/master/tap18.md) — Sigstore/Fulcio Integration
  - [TAP 19](https://github.com/theupdateframework/taps/blob/master/tap19.md) — Content Addressable Targets
  - [TAP 20](https://github.com/theupdateframework/taps/blob/master/tap20.md) — Self-Revocation

The constraint extraction, TAP interaction analysis, and security impact summaries were generated with the assistance of Claude (Anthropic), using the above TAP documents and specification as input context. The interactions were then reviewed for correctness against the source material.
