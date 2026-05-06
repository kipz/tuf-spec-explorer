import type { SpecData } from '../../types'
import type { ResolvedConstraint } from '../../data/selectors'
import { safeHref } from '../../lib/safe-href'
import { PlusIcon, MinusIcon, ArrowIcon, WarnIcon } from '../../icons'

interface Props {
  constraint: ResolvedConstraint
  data: SpecData
}

export function ConstraintCard({ constraint, data }: Props) {
  const tapForFirstChange =
    constraint.changes.length > 0
      ? data.taps.find(t => t.tap === constraint.changes[0].tapNumber)
      : undefined

  return (
    <div className={`constraint-row ${constraint.status}`}>
      <div className="constraint-header">
        {constraint.changes.length > 0 && (
          <span
            className={`change-indicator ${
              constraint.status === 'new'
                ? 'added'
                : constraint.status === 'incompatible'
                  ? 'incompatible'
                  : constraint.status
            }`}
          >
            {constraint.status === 'new' && (
              <>
                <PlusIcon /> Added
              </>
            )}
            {constraint.status === 'removed' && (
              <>
                <MinusIcon /> Removed
              </>
            )}
            {constraint.status === 'modified' && (
              <>
                <ArrowIcon /> Relaxed
              </>
            )}
            {constraint.status === 'incompatible' && (
              <>
                <WarnIcon /> Incompatible
              </>
            )}
          </span>
        )}
        {constraint.specSection ? (
          <a
            className="constraint-id"
            href={safeHref(`${data.spec.url}#${constraint.specSection}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {constraint.id}
          </a>
        ) : tapForFirstChange?.url ? (
          <a
            className="constraint-id"
            href={safeHref(tapForFirstChange.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {constraint.id}
          </a>
        ) : (
          <span className="constraint-id">{constraint.id}</span>
        )}
      </div>
      <div className="constraint-desc">{constraint.description}</div>
      {constraint.changes.map((change, i) => {
        const sourceTap = data.taps.find(t => t.tap === change.tapNumber)
        return (
          <div key={`${change.constraintId}-${change.tapNumber}-${i}`}>
            {change.before && change.after && (
              <div className="diff-block">
                <div className="diff-before">
                  <span className="diff-prefix">-</span>
                  {change.before}
                </div>
                <div className="diff-after">
                  <span className="diff-prefix">+</span>
                  {change.after}
                </div>
              </div>
            )}
            <div className="detail">{change.detail}</div>
            <div className="tap-source">
              via{' '}
              <a href={safeHref(sourceTap?.url)} target="_blank" rel="noopener noreferrer">
                TAP {change.tapNumber}: {change.tapTitle}
              </a>
            </div>
          </div>
        )
      })}
      {constraint.status === 'incompatible' && constraint.changes[0] && (
        <div className="incompat-block">{constraint.changes[0].detail}</div>
      )}
    </div>
  )
}
