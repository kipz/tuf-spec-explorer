import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { validateSpecData, ValidationError } from '../src/data/validate'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = resolve(__dirname, '../src/tuf-spec-data.json')

interface CrossRefError {
  path: string
  message: string
}

function crossReferenceCheck(data: ReturnType<typeof validateSpecData>): CrossRefError[] {
  const errors: CrossRefError[] = []
  const tapNumbers = new Set([...data.taps.map(t => t.tap), ...data.incorporatedTaps.map(t => t.tap)])
  const baseConstraintIds = new Set(Object.values(data.spec.constraints).map(c => c.id))
  const tapNumbersOnly = new Set(data.taps.map(t => t.tap))

  // Build set of all valid constraint IDs (base + introduced by any TAP + incompat IDs)
  const validConstraintIds = new Set<string>(baseConstraintIds)
  for (const tap of data.taps) {
    for (const change of tap.constraintChanges) {
      validConstraintIds.add(change.constraintId)
    }
    if (tap.incompatibilities) {
      validConstraintIds.add(`INCOMPAT-TAP${tap.tap}`)
    }
  }
  for (const interaction of data.tapInteractions) {
    if (interaction.constraintEffects) {
      for (const effect of interaction.constraintEffects) {
        validConstraintIds.add(effect.constraintId)
      }
    }
  }

  for (const tap of data.taps) {
    for (const dep of tap.dependencies) {
      if (!tapNumbers.has(dep)) {
        errors.push({
          path: `taps[tap=${tap.tap}].dependencies`,
          message: `references non-existent TAP ${dep}`,
        })
      }
    }
    for (const change of tap.constraintChanges) {
      if (!validConstraintIds.has(change.constraintId)) {
        errors.push({
          path: `taps[tap=${tap.tap}].constraintChanges`,
          message: `unknown constraint id "${change.constraintId}"`,
        })
      }
    }
  }

  for (const interaction of data.tapInteractions) {
    for (const t of interaction.taps) {
      if (!tapNumbersOnly.has(t)) {
        errors.push({
          path: `tapInteractions[${interaction.taps.join('+')}].taps`,
          message: `references TAP ${t} not in toggleable taps[]`,
        })
      }
    }
    if (interaction.constraintEffects) {
      for (const effect of interaction.constraintEffects) {
        if (!validConstraintIds.has(effect.constraintId)) {
          errors.push({
            path: `tapInteractions[${interaction.taps.join('+')}].constraintEffects`,
            message: `unknown constraint id "${effect.constraintId}"`,
          })
        }
      }
    }
  }

  for (const impl of data.implementations) {
    for (const support of impl.tapSupport) {
      if (!tapNumbers.has(support.tap)) {
        errors.push({
          path: `implementations[${impl.id}].tapSupport`,
          message: `references non-existent TAP ${support.tap}`,
        })
      }
    }
  }

  return errors
}

function main(): void {
  const raw = JSON.parse(readFileSync(dataPath, 'utf8'))

  let validated: ReturnType<typeof validateSpecData>
  try {
    validated = validateSpecData(raw)
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(`Schema error: ${err.message}`)
    } else {
      console.error(err)
    }
    process.exit(1)
  }

  const crossRefErrors = crossReferenceCheck(validated)
  if (crossRefErrors.length > 0) {
    console.error('Cross-reference errors:')
    for (const e of crossRefErrors) {
      console.error(`  ${e.path}: ${e.message}`)
    }
    process.exit(1)
  }

  console.log(
    `tuf-spec-data.json OK: ${validated.taps.length} taps, ` +
      `${validated.incorporatedTaps.length} incorporated, ` +
      `${validated.tapInteractions.length} interactions, ` +
      `${validated.implementations.length} implementations, ` +
      `${Object.keys(validated.spec.constraints).length} base constraints.`,
  )
}

main()
