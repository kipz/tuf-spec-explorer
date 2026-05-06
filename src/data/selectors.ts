import type { ConstraintChange, Implementation, SpecData, TapInteraction } from '../types'

export interface ResolvedConstraint {
  id: string
  description: string
  specSection?: string
  status: 'unchanged' | 'modified' | 'removed' | 'new' | 'incompatible'
  changes: Array<ConstraintChange & { tapNumber: number; tapTitle: string }>
}

export interface ImplCoverage {
  impl: Implementation
  supportedTaps: number[]
  unsupportedTaps: number[]
}

export function computeConstraints(data: SpecData, activeTaps: Set<number>): ResolvedConstraint[] {
  const base = new Map<string, ResolvedConstraint>()

  for (const [, c] of Object.entries(data.spec.constraints)) {
    base.set(c.id, {
      id: c.id,
      description: c.description,
      specSection: c.specSection,
      status: 'unchanged',
      changes: [],
    })
  }

  const activeTapList = data.taps.filter(t => activeTaps.has(t.tap))
  const newConstraints: ResolvedConstraint[] = []

  for (const tap of activeTapList) {
    for (const change of tap.constraintChanges) {
      const existing = base.get(change.constraintId)
      if (existing) {
        existing.changes.push({ ...change, tapNumber: tap.tap, tapTitle: tap.title })
        if (change.type === 'removed') {
          existing.status = 'removed'
          existing.description = change.after ?? existing.description
        } else if (change.type === 'relaxed') {
          existing.status = 'modified'
          existing.description = change.after ?? existing.description
        }
      } else {
        const existingNew = newConstraints.find(c => c.id === change.constraintId)
        if (existingNew) {
          existingNew.changes.push({ ...change, tapNumber: tap.tap, tapTitle: tap.title })
        } else {
          newConstraints.push({
            id: change.constraintId,
            description: change.description ?? change.after ?? '',
            status: 'new',
            changes: [{ ...change, tapNumber: tap.tap, tapTitle: tap.title }],
          })
        }
      }
    }

    if (tap.incompatibilities) {
      for (const incompat of tap.incompatibilities) {
        const cId = `INCOMPAT-TAP${tap.tap}`
        newConstraints.push({
          id: cId,
          description: incompat.description,
          status: 'incompatible',
          changes: [
            {
              type: 'added',
              constraintId: cId,
              description: incompat.description,
              detail: `Severity: ${incompat.severity}`,
              tapNumber: tap.tap,
              tapTitle: tap.title,
            },
          ],
        })
      }
    }
  }

  // Apply interaction constraint effects after individual TAP changes,
  // so that interactions can override status (e.g. a synergy that removes
  // a constraint that an individual TAP only relaxes).
  const interactions = (data.tapInteractions ?? []).filter(interaction =>
    interaction.taps.every(t => activeTaps.has(t)),
  )

  for (const interaction of interactions) {
    if (!interaction.constraintEffects) continue
    for (const effect of interaction.constraintEffects) {
      const existing = base.get(effect.constraintId)
      if (existing) {
        existing.changes.push({
          ...effect,
          detail: effect.description,
          tapNumber: interaction.taps[0],
          tapTitle: `Interaction: TAPs ${interaction.taps.join('+')}`,
        })
        if (effect.type === 'removed') existing.status = 'removed'
        else if (effect.type === 'relaxed') existing.status = 'modified'
      } else {
        newConstraints.push({
          id: effect.constraintId,
          description: effect.description,
          status: 'new',
          changes: [
            {
              ...effect,
              detail: effect.description,
              tapNumber: interaction.taps[0],
              tapTitle: `Interaction: TAPs ${interaction.taps.join('+')}`,
            },
          ],
        })
      }
    }
  }

  return [...base.values(), ...newConstraints]
}

export function computeActiveInteractions(data: SpecData, activeTaps: Set<number>): TapInteraction[] {
  return (data.tapInteractions ?? []).filter(interaction =>
    interaction.taps.every(t => activeTaps.has(t)),
  )
}

export function checkDependencyWarnings(
  data: SpecData,
  activeTaps: Set<number>,
): Array<{ tap: number; missingDep: number }> {
  const warnings: Array<{ tap: number; missingDep: number }> = []
  const satisfiedTaps = new Set(activeTaps)
  for (const t of data.incorporatedTaps) satisfiedTaps.add(t.tap)
  for (const tap of data.taps) {
    if (!activeTaps.has(tap.tap)) continue
    for (const dep of tap.dependencies) {
      if (!satisfiedTaps.has(dep)) {
        warnings.push({ tap: tap.tap, missingDep: dep })
      }
    }
  }
  return warnings
}

export function computeImplementationCoverage(data: SpecData, activeTaps: Set<number>): ImplCoverage[] {
  return (data.implementations ?? []).map(impl => {
    const supportedTaps: number[] = []
    const unsupportedTaps: number[] = []
    for (const tapNum of activeTaps) {
      if (impl.tapSupport.some(ts => ts.tap === tapNum)) {
        supportedTaps.push(tapNum)
      } else {
        unsupportedTaps.push(tapNum)
      }
    }
    return { impl, supportedTaps, unsupportedTaps }
  })
}

export function computeTapImplCounts(data: SpecData): Map<number, number> {
  const counts = new Map<number, number>()
  for (const impl of data.implementations ?? []) {
    for (const ts of impl.tapSupport) {
      counts.set(ts.tap, (counts.get(ts.tap) ?? 0) + 1)
    }
  }
  return counts
}
