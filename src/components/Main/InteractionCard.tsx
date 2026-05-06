import type { SpecData, TapInteraction } from '../../types'
import { safeHref } from '../../lib/safe-href'

interface Props {
  interaction: TapInteraction
  data: SpecData
}

export function InteractionCard({ interaction, data }: Props) {
  const severityClass =
    interaction.severity === 'breaking' ? 'red' : interaction.severity === 'warning' ? 'amber' : 'blue'
  return (
    <div className={`interaction-card interaction-${interaction.severity}`}>
      <div className="interaction-header">
        <span className="badge badge-interaction-type">{interaction.type}</span>
        <span className={`badge badge-interaction-severity badge-${severityClass}`}>
          {interaction.severity}
        </span>
        <span className="interaction-taps">
          {interaction.taps.map((t, i) => {
            const tapData = data.taps.find(tp => tp.tap === t)
            return (
              <span key={t}>
                {i > 0 && ' + '}
                {tapData ? (
                  <a href={safeHref(tapData.url)} target="_blank" rel="noopener noreferrer">
                    TAP {t}
                  </a>
                ) : (
                  `TAP ${t}`
                )}
              </span>
            )
          })}
        </span>
      </div>
      <div className="interaction-title">{interaction.title}</div>
      <div className="interaction-desc">{interaction.description}</div>
      {interaction.constraintEffects && interaction.constraintEffects.length > 0 && (
        <div className="interaction-effects">
          {interaction.constraintEffects.map((effect, i) => (
            <div key={i} className="interaction-effect">
              <span className="constraint-id">{effect.constraintId}</span>
              <span>{effect.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
