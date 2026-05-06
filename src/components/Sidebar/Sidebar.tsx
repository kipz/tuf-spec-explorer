import type { SpecData } from '../../types'
import { TapCard } from './TapCard'
import { IncorporatedTapCard } from './IncorporatedTapCard'

const GROUPS = [
  { label: 'Deferred', status: 'Deferred', defaultOpen: false },
  { label: 'Rejected', status: 'Rejected', defaultOpen: false },
  { label: 'Accepted', status: 'Accepted', defaultOpen: true },
  { label: 'Draft', status: 'Draft', defaultOpen: true },
] as const

interface Props {
  data: SpecData
  activeTaps: Set<number>
  onToggle: (tap: number) => void
  tapImplCounts: Map<number, number>
}

export function Sidebar({ data, activeTaps, onToggle, tapImplCounts }: Props) {
  return (
    <aside className="sidebar" aria-label="TAP selector">
      <h2 className="visually-hidden">TAPs</h2>
      <details className="sidebar-collapsible">
        <summary>
          <span className="sidebar-group-heading">Incorporated into Spec</span>
        </summary>
        {data.incorporatedTaps.map(tap => (
          <IncorporatedTapCard key={tap.tap} tap={tap} />
        ))}
      </details>
      {GROUPS.map(group => {
        const taps = data.taps.filter(t => t.status === group.status)
        if (taps.length === 0) return null
        return (
          <details
            key={group.status}
            className="sidebar-collapsible"
            open={group.defaultOpen || undefined}
          >
            <summary>
              <span className="sidebar-group-heading">{group.label}</span>
            </summary>
            {taps.map(tap => (
              <TapCard
                key={tap.tap}
                tap={tap}
                active={activeTaps.has(tap.tap)}
                onToggle={() => onToggle(tap.tap)}
                implementationCount={tapImplCounts.get(tap.tap) ?? 0}
              />
            ))}
          </details>
        )
      })}
    </aside>
  )
}
