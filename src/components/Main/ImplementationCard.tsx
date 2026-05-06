import type { ImplCoverage } from '../../data/selectors'
import { safeHref } from '../../lib/safe-href'

interface Props {
  coverage: ImplCoverage
  hasActiveTaps: boolean
}

export function ImplementationCard({ coverage, hasActiveTaps }: Props) {
  const { impl, supportedTaps, unsupportedTaps } = coverage
  const borderClass = !hasActiveTaps
    ? ''
    : unsupportedTaps.length === 0
      ? 'impl-full'
      : supportedTaps.length > 0
        ? 'impl-partial'
        : 'impl-none'

  return (
    <div className={`impl-card ${borderClass}`}>
      <div className="impl-header">
        <a
          href={safeHref(impl.githubUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="impl-name"
        >
          {impl.name}
        </a>
        <span className="badge badge-lang">{impl.language}</span>
        <span className={`badge badge-tier-${impl.tier}`}>{impl.tier}</span>
        <span className={`badge badge-impl-status-${impl.status}`}>{impl.status}</span>
      </div>
      {impl.conformancePercent !== undefined && (
        <div className="impl-conformance">Conformance: {impl.conformancePercent}%</div>
      )}
      {impl.notes && <div className="impl-notes">{impl.notes}</div>}
      {hasActiveTaps && (supportedTaps.length > 0 || unsupportedTaps.length > 0) && (
        <div className="impl-tap-badges">
          {supportedTaps.map(t => (
            <span key={t} className="impl-tap-badge impl-tap-yes">
              TAP {t}
            </span>
          ))}
          {unsupportedTaps.map(t => (
            <span key={t} className="impl-tap-badge impl-tap-no">
              TAP {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
