import { useEffect, useState, useCallback } from 'react'

const PARAM = 'taps'

function parseFromSearch(search: string): Set<number> {
  const params = new URLSearchParams(search)
  const raw = params.get(PARAM)
  if (!raw) return new Set()
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part, 10)
    if (Number.isFinite(n) && n > 0) out.add(n)
  }
  return out
}

function writeToUrl(active: Set<number>): void {
  const url = new URL(window.location.href)
  if (active.size === 0) {
    url.searchParams.delete(PARAM)
  } else {
    url.searchParams.set(PARAM, [...active].sort((a, b) => a - b).join(','))
  }
  window.history.replaceState(null, '', url.toString())
}

export function useActiveTaps(): {
  activeTaps: Set<number>
  toggle: (n: number) => void
  clear: () => void
} {
  const [activeTaps, setActiveTaps] = useState<Set<number>>(() =>
    typeof window === 'undefined' ? new Set() : parseFromSearch(window.location.search),
  )

  useEffect(() => {
    writeToUrl(activeTaps)
  }, [activeTaps])

  useEffect(() => {
    const onPopState = () => setActiveTaps(parseFromSearch(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const toggle = useCallback((n: number) => {
    setActiveTaps(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }, [])

  const clear = useCallback(() => setActiveTaps(new Set()), [])

  return { activeTaps, toggle, clear }
}
