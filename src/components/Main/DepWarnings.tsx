import type { SpecData } from '../../types'
import { WarnIcon } from '../../icons'

interface Props {
  data: SpecData
  warnings: Array<{ tap: number; missingDep: number }>
  onToggle: (tap: number) => void
}

export function DepWarnings({ data, warnings, onToggle }: Props) {
  return (
    <div aria-live="polite">
      {warnings.map((w, i) => {
        const isToggleable = data.taps.some(t => t.tap === w.missingDep)
        return (
          <div key={i} className="dep-warning">
            <span aria-hidden="true">
              <WarnIcon />
            </span>
            TAP {w.tap} depends on TAP {w.missingDep} which is not enabled.
            {isToggleable ? (
              <button className="enable-dep-btn" onClick={() => onToggle(w.missingDep)}>
                Enable TAP {w.missingDep}
              </button>
            ) : (
              <> Enable TAP {w.missingDep} for full effect.</>
            )}
          </div>
        )
      })}
    </div>
  )
}
