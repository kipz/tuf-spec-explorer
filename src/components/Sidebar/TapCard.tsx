import type { KeyboardEvent } from 'react'
import type { Tap } from '../../types'
import { safeHref } from '../../lib/safe-href'

interface Props {
  tap: Tap
  active: boolean
  onToggle: () => void
  implementationCount: number
}

export function TapCard({ tap, active, onToggle, implementationCount }: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div
      className={`tap-card ${active ? 'active' : ''}`}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      role="switch"
      aria-checked={active}
      aria-label={`Toggle TAP ${tap.tap}: ${tap.title}`}
      tabIndex={0}
    >
      <div className="tap-card-header">
        <a
          href={safeHref(tap.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="tap-number"
          onClick={e => e.stopPropagation()}
        >
          TAP {tap.tap}
        </a>
        <span className="tap-title">{tap.title}</span>
        <div className={`toggle ${active ? 'on' : ''}`} aria-hidden="true" />
      </div>
      <div className="tap-meta">
        <span className="badge badge-status">{tap.status}</span>
        {tap.dependencies.length > 0 && (
          <span className="badge badge-dep">needs TAP {tap.dependencies.join(', ')}</span>
        )}
        {tap.requiresMajorBump && <span className="badge badge-breaking">v2.x required</span>}
        <span
          className={`badge ${implementationCount > 0 ? 'badge-impl-some' : 'badge-impl-none'}`}
        >
          {implementationCount} impl{implementationCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="tap-summary">{tap.summary}</div>
    </div>
  )
}
