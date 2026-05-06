import type { SpecData, TapInteraction } from '../../types'
import { LinkIcon } from '../../icons'
import { InteractionCard } from './InteractionCard'

const SEVERITY_ORDER = { breaking: 0, warning: 1, info: 2 } as const

interface Props {
  data: SpecData
  interactions: TapInteraction[]
}

export function InteractionsSection({ data, interactions }: Props) {
  if (interactions.length === 0) return null
  const sorted = [...interactions].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  return (
    <div className="section">
      <h2>
        <LinkIcon /> TAP Interactions ({interactions.length})
      </h2>
      <div className="interaction-grid">
        {sorted.map(interaction => (
          <InteractionCard
            key={`${interaction.type}-${interaction.taps.join(',')}`}
            interaction={interaction}
            data={data}
          />
        ))}
      </div>
    </div>
  )
}
