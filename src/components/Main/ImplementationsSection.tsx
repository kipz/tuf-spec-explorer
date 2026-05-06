import type { ImplementationTier } from '../../types'
import type { ImplCoverage } from '../../data/selectors'
import { ImplementationCard } from './ImplementationCard'

const TIER_ORDER: ImplementationTier[] = ['core', 'third-party', 'sigstore', 'system']
const TIER_LABELS: Record<ImplementationTier, string> = {
  core: 'Core (theupdateframework)',
  'third-party': 'Third-party',
  sigstore: 'Sigstore',
  system: 'System',
}

interface Props {
  total: number
  coverage: ImplCoverage[]
  visibleTiers: Set<ImplementationTier>
  onToggleTier: (tier: ImplementationTier) => void
  hasActiveTaps: boolean
}

export function ImplementationsSection({
  total,
  coverage,
  visibleTiers,
  onToggleTier,
  hasActiveTaps,
}: Props) {
  return (
    <div className="section">
      <h2>Implementations ({total})</h2>
      <div className="impl-tier-filters">
        {TIER_ORDER.map(tier => (
          <label key={tier} className={`impl-tier-filter badge-tier-${tier}`}>
            <input
              type="checkbox"
              checked={visibleTiers.has(tier)}
              onChange={() => onToggleTier(tier)}
            />
            {TIER_LABELS[tier]}
          </label>
        ))}
      </div>
      {TIER_ORDER.map(tier => {
        if (!visibleTiers.has(tier)) return null
        const tierImpls = coverage.filter(c => c.impl.tier === tier)
        if (tierImpls.length === 0) return null
        const sorted = hasActiveTaps
          ? [...tierImpls].sort((a, b) => b.supportedTaps.length - a.supportedTaps.length)
          : tierImpls
        return (
          <div key={tier} className="impl-tier-group">
            <div className="impl-tier-label">{TIER_LABELS[tier]}</div>
            <div className="impl-grid">
              {sorted.map(c => (
                <ImplementationCard key={c.impl.id} coverage={c} hasActiveTaps={hasActiveTaps} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
