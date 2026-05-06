import { describe, it, expect } from 'vitest'
import type { SpecData } from '../types'
import {
  computeConstraints,
  computeActiveInteractions,
  checkDependencyWarnings,
  computeImplementationCoverage,
  computeTapImplCounts,
} from './selectors'

const fixture: SpecData = {
  spec: {
    version: '1.0',
    lastModified: '2026-01-01',
    url: 'https://example.com/spec',
    editors: [],
    roles: {},
    attacks: [],
    constraints: {
      one: { id: 'C-ONE', description: 'baseline one', specSection: 's', status: 'active' },
      two: { id: 'C-TWO', description: 'baseline two', specSection: 's', status: 'active' },
    },
  },
  incorporatedTaps: [{ tap: 99, title: 'Inc', status: 'Final', summary: '' }],
  taps: [
    {
      tap: 1,
      title: 'TAP 1',
      status: 'Draft',
      url: 'https://example.com/1',
      summary: '',
      dependencies: [99],
      requiresMajorBump: false,
      constraintChanges: [
        { type: 'relaxed', constraintId: 'C-ONE', detail: 'relaxes one', after: 'now relaxed' },
      ],
      securityImpact: { mitigates: [], description: '' },
    },
    {
      tap: 2,
      title: 'TAP 2',
      status: 'Draft',
      url: 'https://example.com/2',
      summary: '',
      dependencies: [1],
      requiresMajorBump: false,
      constraintChanges: [
        { type: 'added', constraintId: 'C-NEW', detail: 'new constraint', description: 'a new c' },
      ],
      incompatibilities: [{ description: 'incompat', severity: 'breaking' }],
      securityImpact: { mitigates: ['attack X'], description: 'mitigates X' },
    },
  ],
  tapInteractions: [
    {
      taps: [1, 2],
      type: 'synergy',
      severity: 'info',
      title: 'pair',
      description: '',
      constraintEffects: [{ type: 'removed', constraintId: 'C-TWO', description: 'wipes two' }],
    },
  ],
  processTaps: [],
  implementations: [
    {
      id: 'impl-a',
      name: 'A',
      language: 'Go',
      githubUrl: 'https://example.com/a',
      status: 'active',
      tier: 'core',
      specVersion: '1.0',
      tapSupport: [{ tap: 1, level: 'full' }],
    },
  ],
}

describe('computeConstraints', () => {
  it('keeps base constraints unchanged when no TAPs are active', () => {
    const out = computeConstraints(fixture, new Set())
    expect(out.find(c => c.id === 'C-ONE')?.status).toBe('unchanged')
    expect(out.find(c => c.id === 'C-TWO')?.status).toBe('unchanged')
  })

  it('marks a constraint modified when a TAP relaxes it', () => {
    const out = computeConstraints(fixture, new Set([1]))
    expect(out.find(c => c.id === 'C-ONE')?.status).toBe('modified')
  })

  it('adds new constraints introduced by an active TAP', () => {
    const out = computeConstraints(fixture, new Set([2]))
    expect(out.find(c => c.id === 'C-NEW')?.status).toBe('new')
  })

  it('emits incompatibility entries for TAPs with incompatibilities', () => {
    const out = computeConstraints(fixture, new Set([2]))
    expect(out.find(c => c.id === 'INCOMPAT-TAP2')?.status).toBe('incompatible')
  })

  it('applies interaction effects when both TAPs are active', () => {
    const out = computeConstraints(fixture, new Set([1, 2]))
    expect(out.find(c => c.id === 'C-TWO')?.status).toBe('removed')
  })
})

describe('computeActiveInteractions', () => {
  it('returns no interactions when not all participants are active', () => {
    expect(computeActiveInteractions(fixture, new Set([1])).length).toBe(0)
  })

  it('returns the interaction when all participants are active', () => {
    expect(computeActiveInteractions(fixture, new Set([1, 2])).length).toBe(1)
  })
})

describe('checkDependencyWarnings', () => {
  it('flags missing toggleable deps', () => {
    expect(checkDependencyWarnings(fixture, new Set([2]))).toEqual([{ tap: 2, missingDep: 1 }])
  })

  it('treats incorporated TAPs as satisfied deps', () => {
    expect(checkDependencyWarnings(fixture, new Set([1]))).toEqual([])
  })

  it('returns empty when nothing is active', () => {
    expect(checkDependencyWarnings(fixture, new Set())).toEqual([])
  })
})

describe('computeImplementationCoverage', () => {
  it('splits supported and unsupported TAPs per impl', () => {
    const cov = computeImplementationCoverage(fixture, new Set([1, 2]))
    expect(cov[0].supportedTaps).toEqual([1])
    expect(cov[0].unsupportedTaps).toEqual([2])
  })
})

describe('computeTapImplCounts', () => {
  it('counts implementations per TAP', () => {
    const counts = computeTapImplCounts(fixture)
    expect(counts.get(1)).toBe(1)
    expect(counts.get(2)).toBeUndefined()
  })
})
