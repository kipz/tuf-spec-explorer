import type {
  SpecData,
  Tap,
  TapInteraction,
  Implementation,
  Constraint,
  Role,
} from '../types'

class ValidationError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ValidationError'
  }
}

const STATUSES = ['Accepted', 'Draft', 'Rejected', 'Deferred'] as const
const TIERS = ['core', 'third-party', 'sigstore', 'system'] as const
const IMPL_STATUSES = ['active', 'pre-production', 'alpha', 'archived'] as const
const INTERACTION_TYPES = ['synergy', 'tension', 'conflict', 'compound'] as const
const SEVERITIES = ['info', 'warning', 'breaking'] as const
const CHANGE_TYPES = ['added', 'removed', 'relaxed'] as const
const INCOMPAT_SEVERITIES = ['breaking', 'warning'] as const

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

function requireField(obj: Record<string, unknown>, path: string, key: string): unknown {
  if (!(key in obj)) throw new ValidationError(`${path}.${key}`, 'missing required field')
  return obj[key]
}

function requireString(obj: Record<string, unknown>, path: string, key: string): string {
  const v = requireField(obj, path, key)
  if (!isString(v)) throw new ValidationError(`${path}.${key}`, `expected string, got ${typeof v}`)
  return v
}

function requireNumber(obj: Record<string, unknown>, path: string, key: string): number {
  const v = requireField(obj, path, key)
  if (!isNumber(v)) throw new ValidationError(`${path}.${key}`, `expected number, got ${typeof v}`)
  return v
}

function requireBoolean(obj: Record<string, unknown>, path: string, key: string): boolean {
  const v = requireField(obj, path, key)
  if (!isBoolean(v)) throw new ValidationError(`${path}.${key}`, `expected boolean, got ${typeof v}`)
  return v
}

function requireOneOf<T extends string>(
  obj: Record<string, unknown>,
  path: string,
  key: string,
  allowed: readonly T[],
): T {
  const v = requireString(obj, path, key)
  if (!allowed.includes(v as T)) {
    throw new ValidationError(`${path}.${key}`, `expected one of ${allowed.join(', ')}, got "${v}"`)
  }
  return v as T
}

function requireArray(obj: Record<string, unknown>, path: string, key: string): unknown[] {
  const v = requireField(obj, path, key)
  if (!Array.isArray(v)) throw new ValidationError(`${path}.${key}`, 'expected array')
  return v
}

function requireObject(obj: Record<string, unknown>, path: string, key: string): Record<string, unknown> {
  const v = requireField(obj, path, key)
  if (!isObject(v)) throw new ValidationError(`${path}.${key}`, 'expected object')
  return v
}

function assertHttpsUrl(value: string, path: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ValidationError(path, `not a valid URL: "${value}"`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError(path, `URL must be http(s), got "${parsed.protocol}" in "${value}"`)
  }
}

function validateRole(raw: unknown, path: string): Role {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  return {
    description: requireString(raw, path, 'description'),
    keyPolicy: requireString(raw, path, 'keyPolicy'),
    constraints: requireArray(raw, path, 'constraints').map((c, i) => {
      if (!isString(c)) throw new ValidationError(`${path}.constraints[${i}]`, 'expected string')
      return c
    }),
  }
}

function validateConstraint(raw: unknown, path: string): Constraint {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  return {
    id: requireString(raw, path, 'id'),
    description: requireString(raw, path, 'description'),
    specSection: requireString(raw, path, 'specSection'),
    status: requireOneOf(raw, path, 'status', ['active'] as const),
  }
}

function validateConstraintChange(raw: unknown, path: string): Tap['constraintChanges'][number] {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  const result: Tap['constraintChanges'][number] = {
    type: requireOneOf(raw, path, 'type', CHANGE_TYPES),
    constraintId: requireString(raw, path, 'constraintId'),
    detail: requireString(raw, path, 'detail'),
  }
  if ('description' in raw && raw.description !== undefined) {
    if (!isString(raw.description)) throw new ValidationError(`${path}.description`, 'expected string')
    result.description = raw.description
  }
  if ('before' in raw && raw.before !== undefined) {
    if (!isString(raw.before)) throw new ValidationError(`${path}.before`, 'expected string')
    result.before = raw.before
  }
  if ('after' in raw && raw.after !== undefined) {
    if (!isString(raw.after)) throw new ValidationError(`${path}.after`, 'expected string')
    result.after = raw.after
  }
  return result
}

function validateTap(raw: unknown, path: string): Tap {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  const url = requireString(raw, path, 'url')
  assertHttpsUrl(url, `${path}.url`)
  const securityImpactRaw = requireObject(raw, path, 'securityImpact')
  const securityImpact = {
    description: requireString(securityImpactRaw, `${path}.securityImpact`, 'description'),
    mitigates: requireArray(securityImpactRaw, `${path}.securityImpact`, 'mitigates').map((m, i) => {
      if (!isString(m)) throw new ValidationError(`${path}.securityImpact.mitigates[${i}]`, 'expected string')
      return m
    }),
  }
  const tap: Tap = {
    tap: requireNumber(raw, path, 'tap'),
    title: requireString(raw, path, 'title'),
    status: requireOneOf(raw, path, 'status', STATUSES),
    url,
    summary: requireString(raw, path, 'summary'),
    dependencies: requireArray(raw, path, 'dependencies').map((d, i) => {
      if (!isNumber(d)) throw new ValidationError(`${path}.dependencies[${i}]`, 'expected number')
      return d
    }),
    requiresMajorBump: requireBoolean(raw, path, 'requiresMajorBump'),
    constraintChanges: requireArray(raw, path, 'constraintChanges').map((c, i) =>
      validateConstraintChange(c, `${path}.constraintChanges[${i}]`),
    ),
    securityImpact,
  }
  if ('incompatibilities' in raw && raw.incompatibilities !== undefined) {
    const arr = raw.incompatibilities
    if (!Array.isArray(arr)) throw new ValidationError(`${path}.incompatibilities`, 'expected array')
    tap.incompatibilities = arr.map((inc, i) => {
      if (!isObject(inc)) throw new ValidationError(`${path}.incompatibilities[${i}]`, 'expected object')
      return {
        description: requireString(inc, `${path}.incompatibilities[${i}]`, 'description'),
        severity: requireOneOf(inc, `${path}.incompatibilities[${i}]`, 'severity', INCOMPAT_SEVERITIES),
      }
    })
  }
  return tap
}

function validateInteraction(raw: unknown, path: string): TapInteraction {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  const interaction: TapInteraction = {
    taps: requireArray(raw, path, 'taps').map((t, i) => {
      if (!isNumber(t)) throw new ValidationError(`${path}.taps[${i}]`, 'expected number')
      return t
    }),
    type: requireOneOf(raw, path, 'type', INTERACTION_TYPES),
    severity: requireOneOf(raw, path, 'severity', SEVERITIES),
    title: requireString(raw, path, 'title'),
    description: requireString(raw, path, 'description'),
  }
  if ('constraintEffects' in raw && raw.constraintEffects !== undefined) {
    const arr = raw.constraintEffects
    if (!Array.isArray(arr)) throw new ValidationError(`${path}.constraintEffects`, 'expected array')
    interaction.constraintEffects = arr.map((e, i) => {
      if (!isObject(e)) throw new ValidationError(`${path}.constraintEffects[${i}]`, 'expected object')
      return {
        type: requireOneOf(e, `${path}.constraintEffects[${i}]`, 'type', CHANGE_TYPES),
        constraintId: requireString(e, `${path}.constraintEffects[${i}]`, 'constraintId'),
        description: requireString(e, `${path}.constraintEffects[${i}]`, 'description'),
      }
    })
  }
  return interaction
}

function validateImplementation(raw: unknown, path: string): Implementation {
  if (!isObject(raw)) throw new ValidationError(path, 'expected object')
  const githubUrl = requireString(raw, path, 'githubUrl')
  assertHttpsUrl(githubUrl, `${path}.githubUrl`)
  const tapSupport = requireArray(raw, path, 'tapSupport').map((s, i) => {
    if (!isObject(s)) throw new ValidationError(`${path}.tapSupport[${i}]`, 'expected object')
    const support: Implementation['tapSupport'][number] = {
      tap: requireNumber(s, `${path}.tapSupport[${i}]`, 'tap'),
      level: requireOneOf(s, `${path}.tapSupport[${i}]`, 'level', ['full', 'partial'] as const),
    }
    if ('notes' in s && s.notes !== undefined) {
      if (!isString(s.notes)) throw new ValidationError(`${path}.tapSupport[${i}].notes`, 'expected string')
      support.notes = s.notes
    }
    return support
  })
  const impl: Implementation = {
    id: requireString(raw, path, 'id'),
    name: requireString(raw, path, 'name'),
    language: requireString(raw, path, 'language'),
    githubUrl,
    status: requireOneOf(raw, path, 'status', IMPL_STATUSES),
    tier: requireOneOf(raw, path, 'tier', TIERS),
    specVersion: requireString(raw, path, 'specVersion'),
    tapSupport,
  }
  if ('conformancePercent' in raw && raw.conformancePercent !== undefined) {
    if (!isNumber(raw.conformancePercent)) {
      throw new ValidationError(`${path}.conformancePercent`, 'expected number')
    }
    impl.conformancePercent = raw.conformancePercent
  }
  if ('notes' in raw && raw.notes !== undefined) {
    if (!isString(raw.notes)) throw new ValidationError(`${path}.notes`, 'expected string')
    impl.notes = raw.notes
  }
  return impl
}

export function validateSpecData(input: unknown): SpecData {
  if (!isObject(input)) throw new ValidationError('$', 'expected root object')

  const specRaw = requireObject(input, '$', 'spec')
  const specUrl = requireString(specRaw, '$.spec', 'url')
  assertHttpsUrl(specUrl, '$.spec.url')

  const rolesRaw = requireObject(specRaw, '$.spec', 'roles')
  const roles: Record<string, Role> = {}
  for (const [k, v] of Object.entries(rolesRaw)) {
    roles[k] = validateRole(v, `$.spec.roles.${k}`)
  }

  const constraintsRaw = requireObject(specRaw, '$.spec', 'constraints')
  const constraints: Record<string, Constraint> = {}
  for (const [k, v] of Object.entries(constraintsRaw)) {
    constraints[k] = validateConstraint(v, `$.spec.constraints.${k}`)
  }

  const spec: SpecData['spec'] = {
    version: requireString(specRaw, '$.spec', 'version'),
    lastModified: requireString(specRaw, '$.spec', 'lastModified'),
    url: specUrl,
    editors: requireArray(specRaw, '$.spec', 'editors').map((e, i) => {
      if (!isString(e)) throw new ValidationError(`$.spec.editors[${i}]`, 'expected string')
      return e
    }),
    roles,
    attacks: requireArray(specRaw, '$.spec', 'attacks').map((a, i) => {
      if (!isString(a)) throw new ValidationError(`$.spec.attacks[${i}]`, 'expected string')
      return a
    }),
    constraints,
  }

  const incorporatedTaps = requireArray(input, '$', 'incorporatedTaps').map((t, i) => {
    const path = `$.incorporatedTaps[${i}]`
    if (!isObject(t)) throw new ValidationError(path, 'expected object')
    return {
      tap: requireNumber(t, path, 'tap'),
      title: requireString(t, path, 'title'),
      status: requireString(t, path, 'status'),
      summary: requireString(t, path, 'summary'),
    }
  })

  const taps = requireArray(input, '$', 'taps').map((t, i) => validateTap(t, `$.taps[${i}]`))
  const tapInteractions = requireArray(input, '$', 'tapInteractions').map((i_, i) =>
    validateInteraction(i_, `$.tapInteractions[${i}]`),
  )
  const processTaps = requireArray(input, '$', 'processTaps').map((t, i) => {
    const path = `$.processTaps[${i}]`
    if (!isObject(t)) throw new ValidationError(path, 'expected object')
    return {
      tap: requireNumber(t, path, 'tap'),
      title: requireString(t, path, 'title'),
      notes: requireString(t, path, 'notes'),
    }
  })
  const implementations = requireArray(input, '$', 'implementations').map((i_, i) =>
    validateImplementation(i_, `$.implementations[${i}]`),
  )

  return {
    spec,
    incorporatedTaps,
    taps,
    tapInteractions,
    processTaps,
    implementations,
  }
}

export { ValidationError }
