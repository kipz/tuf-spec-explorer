import { describe, it, expect } from 'vitest'
import { validateSpecData, ValidationError } from './validate'

const minimalValid = {
  spec: {
    version: '1.0',
    lastModified: '2026-01-01',
    url: 'https://example.com/spec',
    editors: ['Alice'],
    roles: {},
    attacks: [],
    constraints: {},
  },
  incorporatedTaps: [],
  taps: [],
  tapInteractions: [],
  processTaps: [],
  implementations: [],
}

describe('validateSpecData', () => {
  it('accepts a minimal valid object', () => {
    expect(() => validateSpecData(minimalValid)).not.toThrow()
  })

  it('rejects non-object input', () => {
    expect(() => validateSpecData(null)).toThrow(ValidationError)
    expect(() => validateSpecData('foo')).toThrow(ValidationError)
    expect(() => validateSpecData([])).toThrow(ValidationError)
  })

  it('rejects missing required spec field', () => {
    const { spec: _spec, ...rest } = minimalValid
    expect(() => validateSpecData(rest)).toThrow(/spec.*missing/)
  })

  it('rejects javascript: spec URL', () => {
    expect(() =>
      validateSpecData({ ...minimalValid, spec: { ...minimalValid.spec, url: 'javascript:alert(1)' } }),
    ).toThrow(/URL must be http/)
  })

  it('rejects unknown TAP status', () => {
    const bad = {
      ...minimalValid,
      taps: [
        {
          tap: 1,
          title: 't',
          status: 'NotAStatus',
          url: 'https://example.com',
          summary: 's',
          dependencies: [],
          requiresMajorBump: false,
          constraintChanges: [],
          securityImpact: { mitigates: [], description: 'd' },
        },
      ],
    }
    expect(() => validateSpecData(bad)).toThrow(/expected one of/)
  })

  it('rejects javascript: TAP url', () => {
    const bad = {
      ...minimalValid,
      taps: [
        {
          tap: 1,
          title: 't',
          status: 'Draft',
          url: 'javascript:alert(1)',
          summary: 's',
          dependencies: [],
          requiresMajorBump: false,
          constraintChanges: [],
          securityImpact: { mitigates: [], description: 'd' },
        },
      ],
    }
    expect(() => validateSpecData(bad)).toThrow(/URL must be http/)
  })

  it('accepts the real bundled data file', async () => {
    const real = (await import('../tuf-spec-data.json')).default
    expect(() => validateSpecData(real)).not.toThrow()
  })
})
