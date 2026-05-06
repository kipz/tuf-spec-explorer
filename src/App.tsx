import { useEffect, useMemo } from 'react'
import { specData as data } from './data'
import {
  computeActiveInteractions,
  computeConstraints,
  computeImplementationCoverage,
  computeTapImplCounts,
  checkDependencyWarnings,
} from './data/selectors'
import { useActiveTaps } from './hooks/useActiveTaps'
import { useLocalStorage } from './hooks/useLocalStorage'
import type { ImplementationTier } from './types'
import { Header } from './components/Header/Header'
import { Sidebar } from './components/Sidebar/Sidebar'
import { EmptyState } from './components/Main/EmptyState'
import { DepWarnings } from './components/Main/DepWarnings'
import { SummaryBar } from './components/Main/SummaryBar'
import { ImplementationsSection } from './components/Main/ImplementationsSection'
import { InteractionsSection } from './components/Main/InteractionsSection'
import { SecurityImpactSection } from './components/Main/SecurityImpactSection'
import { ConstraintsSection } from './components/Main/ConstraintsSection'

const TIER_SET_SERIALIZE = (s: Set<ImplementationTier>) => JSON.stringify([...s])
const TIER_SET_DESERIALIZE = (raw: string): Set<ImplementationTier> => {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter(v => typeof v === 'string')) as Set<ImplementationTier>
    }
  } catch {
    // ignore malformed value
  }
  return new Set(['core'])
}

function readInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // ignore storage errors
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

const tapImplCounts = computeTapImplCounts(data)

export function App() {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>(
    'theme',
    readInitialTheme(),
    v => v,
    raw => (raw === 'dark' ? 'dark' : 'light'),
  )
  const { activeTaps, toggle: toggleTap, clear: clearTaps } = useActiveTaps()
  const [visibleTiers, setVisibleTiers] = useLocalStorage<Set<ImplementationTier>>(
    'visibleTiers',
    new Set(['core']),
    TIER_SET_SERIALIZE,
    TIER_SET_DESERIALIZE,
  )
  const [disclaimerDismissed, setDisclaimerDismissed] = useLocalStorage<boolean>(
    'disclaimer-llm-v1-dismissed',
    false,
    v => (v ? '1' : '0'),
    raw => raw === '1',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const base = 'TUF Spec Explorer'
    document.title = activeTaps.size > 0 ? `${base} — ${activeTaps.size} selected` : base
  }, [activeTaps.size])

  const constraints = useMemo(() => computeConstraints(data, activeTaps), [activeTaps])
  const activeInteractions = useMemo(() => computeActiveInteractions(data, activeTaps), [activeTaps])
  const depWarnings = useMemo(() => checkDependencyWarnings(data, activeTaps), [activeTaps])
  const securityImpacts = useMemo(
    () => data.taps.filter(t => activeTaps.has(t.tap) && t.securityImpact.mitigates.length > 0),
    [activeTaps],
  )
  const implCoverage = useMemo(() => computeImplementationCoverage(data, activeTaps), [activeTaps])
  const supportingImplCount = useMemo(() => {
    if (activeTaps.size === 0) return 0
    return implCoverage.filter(c => c.unsupportedTaps.length === 0 && c.supportedTaps.length > 0).length
  }, [implCoverage, activeTaps.size])

  const changedConstraints = constraints.filter(c => c.status !== 'unchanged')
  const unchangedConstraints = constraints.filter(c => c.status === 'unchanged')

  const stats = {
    added: changedConstraints.filter(c => c.status === 'new').length,
    removed: changedConstraints.filter(c => c.status === 'removed').length,
    relaxed: changedConstraints.filter(c => c.status === 'modified').length,
    incompatible: changedConstraints.filter(c => c.status === 'incompatible').length,
  }

  const toggleTier = (tier: ImplementationTier) => {
    setVisibleTiers(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })
  }

  return (
    <div className="app">
      <Header
        data={data}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        disclaimerDismissed={disclaimerDismissed}
        onDismissDisclaimer={() => setDisclaimerDismissed(true)}
        activeTapsCount={activeTaps.size}
        onClearTaps={clearTaps}
      />

      <div className="layout">
        <Sidebar
          data={data}
          activeTaps={activeTaps}
          onToggle={toggleTap}
          tapImplCounts={tapImplCounts}
        />

        <main className="main" aria-label="TAP impact">
          <DepWarnings data={data} warnings={depWarnings} onToggle={toggleTap} />

          {activeTaps.size === 0 ? (
            <EmptyState />
          ) : (
            <SummaryBar stats={stats} supportingImplCount={supportingImplCount} />
          )}

          <ImplementationsSection
            total={data.implementations?.length ?? 0}
            coverage={implCoverage}
            visibleTiers={visibleTiers}
            onToggleTier={toggleTier}
            hasActiveTaps={activeTaps.size > 0}
          />

          {activeTaps.size > 0 && (
            <>
              <InteractionsSection data={data} interactions={activeInteractions} />
              <SecurityImpactSection taps={securityImpacts} />
              <ConstraintsSection
                data={data}
                changed={changedConstraints}
                unchanged={unchangedConstraints}
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
