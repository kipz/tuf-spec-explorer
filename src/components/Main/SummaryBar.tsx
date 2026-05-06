interface Stats {
  added: number
  removed: number
  relaxed: number
  incompatible: number
}

interface Props {
  stats: Stats
  supportingImplCount: number
}

const SLOTS: Array<{ key: keyof Stats; label: string; dot: string }> = [
  { key: 'added', label: 'added', dot: 'green' },
  { key: 'relaxed', label: 'relaxed', dot: 'blue' },
  { key: 'removed', label: 'removed', dot: 'red' },
  { key: 'incompatible', label: 'incompatible', dot: 'amber' },
]

export function SummaryBar({ stats, supportingImplCount }: Props) {
  return (
    <div className="summary-bar" aria-live="polite" aria-atomic="true">
      {SLOTS.map(s => {
        const count = stats[s.key]
        return (
          <div key={s.key} className={`summary-stat ${count === 0 ? 'is-zero' : ''}`}>
            <div className={`stat-dot ${s.dot}`} aria-hidden="true" />
            <span className="stat-count">{count}</span> {s.label}
          </div>
        )
      })}
      <div className="summary-stat">
        <div
          className={`stat-dot ${supportingImplCount > 0 ? 'green' : 'red'}`}
          aria-hidden="true"
        />
        <span className="stat-count">{supportingImplCount}</span> impl
        {supportingImplCount !== 1 ? 's' : ''} support{supportingImplCount === 1 ? 's' : ''} this
      </div>
    </div>
  )
}
