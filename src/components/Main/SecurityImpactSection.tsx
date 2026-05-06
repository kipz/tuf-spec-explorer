import type { Tap } from '../../types'
import { safeHref } from '../../lib/safe-href'
import { ShieldIcon } from '../../icons'

interface Props {
  taps: Tap[]
}

export function SecurityImpactSection({ taps }: Props) {
  if (taps.length === 0) return null
  return (
    <div className="section">
      <h2>Security Impact</h2>
      {taps.map(tap => (
        <div key={tap.tap} className="security-section">
          <h3>
            <ShieldIcon />{' '}
            <a href={safeHref(tap.url)} target="_blank" rel="noopener noreferrer">
              TAP {tap.tap}
            </a>
            : {tap.title}
          </h3>
          <p>{tap.securityImpact.description}</p>
          <div className="mitigates-list">
            {tap.securityImpact.mitigates.map(a => (
              <span key={a} className="mitigates-badge">
                {a}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
