import { useMemo, useState } from 'react'
import type { SpecData, Tap } from '../../types'
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

function matchesQuery(tap: Tap, q: string): boolean {
  if (!q) return true
  const haystack = `tap ${tap.tap} ${tap.title} ${tap.summary} ${tap.status}`.toLowerCase()
  return haystack.includes(q)
}

export function Sidebar({ data, activeTaps, onToggle, tapImplCounts }: Props) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  const filteredByStatus = useMemo(() => {
    const out: Record<string, Tap[]> = {}
    for (const tap of data.taps) {
      if (!matchesQuery(tap, q)) continue
      out[tap.status] = out[tap.status] ?? []
      out[tap.status].push(tap)
    }
    return out
  }, [data.taps, q])

  const incorporatedMatches = q
    ? data.incorporatedTaps.filter(t =>
        `tap ${t.tap} ${t.title} ${t.summary} ${t.status}`.toLowerCase().includes(q),
      )
    : data.incorporatedTaps

  return (
    <aside className="sidebar" aria-label="TAP selector">
      <h2 className="visually-hidden">TAPs</h2>
      <input
        type="search"
        className="sidebar-search"
        placeholder="Search TAPs…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        aria-label="Search TAPs"
      />
      {incorporatedMatches.length > 0 && (
        <details className="sidebar-collapsible" open={!!q || undefined}>
          <summary>
            <span className="sidebar-group-heading">Incorporated into Spec</span>
          </summary>
          {incorporatedMatches.map(tap => (
            <IncorporatedTapCard key={tap.tap} tap={tap} />
          ))}
        </details>
      )}
      {GROUPS.map(group => {
        const taps = filteredByStatus[group.status] ?? []
        if (taps.length === 0) return null
        const open = !!q || group.defaultOpen
        return (
          <details
            key={group.status}
            className="sidebar-collapsible"
            open={open || undefined}
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
