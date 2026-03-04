import { useState, useMemo } from 'react'
import specData from './tuf-spec-data.json'
import type { SpecData, Tap, ConstraintChange, TapInteraction, Implementation, ImplementationTier } from './types'

const data = specData as SpecData

interface ResolvedConstraint {
  id: string;
  description: string;
  specSection?: string;
  status: 'unchanged' | 'modified' | 'removed' | 'new' | 'incompatible';
  changes: Array<ConstraintChange & { tapNumber: number; tapTitle: string }>;
}

function computeConstraints(activeTaps: Set<number>): ResolvedConstraint[] {
  const base = new Map<string, ResolvedConstraint>()

  for (const [, c] of Object.entries(data.spec.constraints)) {
    base.set(c.id, {
      id: c.id,
      description: c.description,
      specSection: c.specSection,
      status: 'unchanged',
      changes: [],
    })
  }

  const activeTapList = data.taps.filter(t => activeTaps.has(t.tap))
  const newConstraints: ResolvedConstraint[] = []

  for (const tap of activeTapList) {
    for (const change of tap.constraintChanges) {
      const existing = base.get(change.constraintId)
      if (existing) {
        existing.changes.push({ ...change, tapNumber: tap.tap, tapTitle: tap.title })
        if (change.type === 'removed') {
          existing.status = 'removed'
          existing.description = change.after ?? existing.description
        } else if (change.type === 'relaxed') {
          existing.status = 'modified'
          existing.description = change.after ?? existing.description
        }
      } else {
        const existingNew = newConstraints.find(c => c.id === change.constraintId)
        if (existingNew) {
          existingNew.changes.push({ ...change, tapNumber: tap.tap, tapTitle: tap.title })
        } else {
          newConstraints.push({
            id: change.constraintId,
            description: change.description ?? change.after ?? '',
            status: 'new',
            changes: [{ ...change, tapNumber: tap.tap, tapTitle: tap.title }],
          })
        }
      }
    }

    if (tap.incompatibilities) {
      for (const incompat of tap.incompatibilities) {
        const cId = `INCOMPAT-TAP${tap.tap}`
        newConstraints.push({
          id: cId,
          description: incompat.description,
          status: 'incompatible',
          changes: [{
            type: 'added',
            constraintId: cId,
            description: incompat.description,
            detail: `Severity: ${incompat.severity}`,
            tapNumber: tap.tap,
            tapTitle: tap.title,
          }],
        })
      }
    }
  }

  // Apply interaction constraint effects
  const interactions = data.tapInteractions?.filter(
    interaction => interaction.taps.every(t => activeTaps.has(t))
  ) ?? []

  for (const interaction of interactions) {
    if (!interaction.constraintEffects) continue
    for (const effect of interaction.constraintEffects) {
      const existing = base.get(effect.constraintId)
      if (existing) {
        existing.changes.push({
          ...effect,
          detail: effect.description,
          tapNumber: interaction.taps[0],
          tapTitle: `Interaction: TAPs ${interaction.taps.join('+')}`,
        })
        if (effect.type === 'removed') existing.status = 'removed'
        else if (effect.type === 'relaxed') existing.status = 'modified'
      } else {
        newConstraints.push({
          id: effect.constraintId,
          description: effect.description,
          status: 'new',
          changes: [{
            ...effect,
            detail: effect.description,
            tapNumber: interaction.taps[0],
            tapTitle: `Interaction: TAPs ${interaction.taps.join('+')}`,
          }],
        })
      }
    }
  }

  return [...base.values(), ...newConstraints]
}

function computeActiveInteractions(activeTaps: Set<number>): TapInteraction[] {
  return (data.tapInteractions ?? []).filter(
    interaction => interaction.taps.every(t => activeTaps.has(t))
  )
}

function checkDependencyWarnings(activeTaps: Set<number>): Array<{ tap: number; missingDep: number }> {
  const warnings: Array<{ tap: number; missingDep: number }> = []
  for (const tap of data.taps) {
    if (activeTaps.has(tap.tap)) {
      for (const dep of tap.dependencies) {
        if (!activeTaps.has(dep)) {
          warnings.push({ tap: tap.tap, missingDep: dep })
        }
      }
    }
  }
  return warnings
}

interface ImplCoverage {
  impl: Implementation;
  supportedTaps: number[];
  unsupportedTaps: number[];
}

function computeImplementationCoverage(activeTaps: Set<number>): ImplCoverage[] {
  return (data.implementations ?? []).map(impl => {
    const supportedTaps: number[] = []
    const unsupportedTaps: number[] = []
    for (const tapNum of activeTaps) {
      if (impl.tapSupport.some(ts => ts.tap === tapNum)) {
        supportedTaps.push(tapNum)
      } else {
        unsupportedTaps.push(tapNum)
      }
    }
    return { impl, supportedTaps, unsupportedTaps }
  })
}

function computeTapImplCounts(): Map<number, number> {
  const counts = new Map<number, number>()
  for (const impl of data.implementations ?? []) {
    for (const ts of impl.tapSupport) {
      counts.set(ts.tap, (counts.get(ts.tap) ?? 0) + 1)
    }
  }
  return counts
}

const tierOrder: ImplementationTier[] = ['core', 'third-party', 'sigstore', 'system']
const tierLabels: Record<ImplementationTier, string> = {
  core: 'Core (theupdateframework)',
  'third-party': 'Third-party',
  sigstore: 'Sigstore',
  system: 'System',
}

function ImplementationCard({ coverage, hasActiveTaps }: { coverage: ImplCoverage; hasActiveTaps: boolean }) {
  const { impl, supportedTaps, unsupportedTaps } = coverage
  const borderClass = !hasActiveTaps
    ? ''
    : unsupportedTaps.length === 0
    ? 'impl-full'
    : supportedTaps.length > 0
    ? 'impl-partial'
    : 'impl-none'

  return (
    <div className={`impl-card ${borderClass}`}>
      <div className="impl-header">
        <a href={impl.githubUrl} target="_blank" rel="noopener noreferrer" className="impl-name">{impl.name}</a>
        <span className="badge badge-lang">{impl.language}</span>
        <span className={`badge badge-tier-${impl.tier}`}>{impl.tier}</span>
        <span className={`badge badge-impl-status-${impl.status}`}>{impl.status}</span>
      </div>
      {impl.conformancePercent !== undefined && (
        <div className="impl-conformance">Conformance: {impl.conformancePercent}%</div>
      )}
      {impl.notes && <div className="impl-notes">{impl.notes}</div>}
      {hasActiveTaps && (supportedTaps.length > 0 || unsupportedTaps.length > 0) && (
        <div className="impl-tap-badges">
          {supportedTaps.map(t => (
            <span key={t} className="impl-tap-badge impl-tap-yes">TAP {t}</span>
          ))}
          {unsupportedTaps.map(t => (
            <span key={t} className="impl-tap-badge impl-tap-no">TAP {t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/></svg>
}

function MinusIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 8a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 8z"/></svg>
}

function ArrowIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 8a.75.75 0 01.75-.75h10.69L9.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H1.75A.75.75 0 011 8z"/></svg>
}

function WarnIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM8 5a.75.75 0 00-.75.75v2.5a.75.75 0 001.5 0v-2.5A.75.75 0 008 5zm1 6a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
}

function ShieldIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16"><path d="M7.467.133a1.75 1.75 0 011.066 0l5.25 1.68A1.75 1.75 0 0115 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.7 1.7 0 01-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 011.217-1.667l5.25-1.68zm.61 1.429a.25.25 0 00-.153 0l-5.25 1.68a.25.25 0 00-.174.238V7c0 1.358.275 2.666 1.057 3.86.784 1.194 2.121 2.34 4.366 3.297a.2.2 0 00.154 0c2.245-.956 3.582-2.104 4.366-3.298C13.225 9.666 13.5 8.36 13.5 7V3.48a.25.25 0 00-.174-.237l-5.25-1.68z"/></svg>
}

function LinkIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16"><path d="M6.354 5.5H4a3 3 0 000 6h3a3 3 0 002.83-4H9a2 2 0 01-2 2H4a2 2 0 010-4h1.354a4.01 4.01 0 01.993-2zM9.646 10.5H12a3 3 0 000-6H9a3 3 0 00-2.83 4H7a2 2 0 012-2h3a2 2 0 010 4h-1.354a4.01 4.01 0 01-.993 2z"/></svg>
}

const severityOrder = { breaking: 0, warning: 1, info: 2 } as const

function InteractionCard({ interaction }: { interaction: TapInteraction }) {
  const severityClass = interaction.severity === 'breaking' ? 'red' : interaction.severity === 'warning' ? 'amber' : 'blue'
  return (
    <div className={`interaction-card interaction-${interaction.severity}`}>
      <div className="interaction-header">
        <span className={`badge badge-interaction-type`}>{interaction.type}</span>
        <span className={`badge badge-interaction-severity badge-${severityClass}`}>{interaction.severity}</span>
        <span className="interaction-taps">
          {interaction.taps.map((t, i) => {
            const tapData = data.taps.find(tp => tp.tap === t)
            return (
              <span key={t}>
                {i > 0 && ' + '}
                {tapData ? <a href={tapData.url} target="_blank" rel="noopener noreferrer">TAP {t}</a> : `TAP ${t}`}
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

function ConstraintCard({ constraint }: { constraint: ResolvedConstraint }) {
  return (
    <div className={`constraint-row ${constraint.status}`}>
      {constraint.changes.length > 0 && (
        <div className={`change-indicator ${constraint.status === 'new' ? 'added' : constraint.status === 'incompatible' ? 'incompatible' : constraint.status}`}>
          {constraint.status === 'new' && <><PlusIcon /> Added</>}
          {constraint.status === 'removed' && <><MinusIcon /> Removed</>}
          {constraint.status === 'modified' && <><ArrowIcon /> Relaxed</>}
          {constraint.status === 'incompatible' && <><WarnIcon /> Incompatible</>}
        </div>
      )}
      <div className="constraint-id">{constraint.id}</div>
      <div className="constraint-desc">{constraint.description}</div>
      {constraint.specSection && (
        <div className="constraint-spec-section">spec &sect;{constraint.specSection}</div>
      )}
      {constraint.changes.map((change, i) => (
        <div key={i}>
          {change.before && change.after && (
            <div className="diff-block">
              <div className="diff-before"><span className="diff-prefix">-</span>{change.before}</div>
              <div className="diff-after"><span className="diff-prefix">+</span>{change.after}</div>
            </div>
          )}
          <div className="detail">{change.detail}</div>
          <div className="tap-source">via TAP {change.tapNumber}: {change.tapTitle}</div>
        </div>
      ))}
      {constraint.status === 'incompatible' && constraint.changes[0] && (
        <div className="incompat-block">{constraint.changes[0].detail}</div>
      )}
    </div>
  )
}

function IncorporatedTapCard({ tap }: { tap: { tap: number; title: string; status: string; summary: string } }) {
  return (
    <div className="incorporated-tap-card">
      <div className="tap-card-header">
        <span className="tap-number">TAP {tap.tap}</span>
        <span className="tap-title">{tap.title}</span>
        <span className="badge badge-final">Final</span>
      </div>
      <div className="tap-summary">{tap.summary}</div>
    </div>
  )
}

function TapCard({ tap, active, onToggle, implementationCount }: { tap: Tap; active: boolean; onToggle: () => void; implementationCount: number }) {
  return (
    <div className={`tap-card ${active ? 'active' : ''}`} onClick={onToggle}>
      <div className="tap-card-header">
        <a href={tap.url} target="_blank" rel="noopener noreferrer" className="tap-number" onClick={e => e.stopPropagation()}>TAP {tap.tap}</a>
        <span className="tap-title">{tap.title}</span>
        <div className={`toggle ${active ? 'on' : ''}`} />
      </div>
      <div className="tap-meta">
        <span className="badge badge-status">{tap.status}</span>
        {tap.dependencies.length > 0 && (
          <span className="badge badge-dep">needs TAP {tap.dependencies.join(', ')}</span>
        )}
        {tap.requiresMajorBump && (
          <span className="badge badge-breaking">v2.x required</span>
        )}
        <span className={`badge ${implementationCount > 0 ? 'badge-impl-some' : 'badge-impl-none'}`}>
          {implementationCount} impl{implementationCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="tap-summary">{tap.summary}</div>
    </div>
  )
}

export function App() {
  const [activeTaps, setActiveTaps] = useState<Set<number>>(new Set())

  const toggleTap = (tapNum: number) => {
    setActiveTaps(prev => {
      const next = new Set(prev)
      if (next.has(tapNum)) {
        next.delete(tapNum)
      } else {
        next.add(tapNum)
      }
      return next
    })
  }

  const constraints = useMemo(() => computeConstraints(activeTaps), [activeTaps])
  const activeInteractions = useMemo(() => computeActiveInteractions(activeTaps), [activeTaps])
  const depWarnings = useMemo(() => checkDependencyWarnings(activeTaps), [activeTaps])
  const securityImpacts = useMemo(() =>
    data.taps.filter(t => activeTaps.has(t.tap) && t.securityImpact.mitigates.length > 0),
    [activeTaps]
  )
  const implCoverage = useMemo(() => computeImplementationCoverage(activeTaps), [activeTaps])
  const tapImplCounts = useMemo(() => computeTapImplCounts(), [])
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

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div className="header-branding">
            <div className="tuf-logo">
              <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
                <rect x="2" y="2" width="36" height="36" rx="8" stroke="var(--accent)" strokeWidth="2.5" />
                <path d="M12 14h16M20 14v14" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M10 28h20" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
                <circle cx="20" cy="11" r="2" fill="var(--accent)" opacity="0.6" />
              </svg>
            </div>
            <div>
              <h1>TUF TAP Explorer</h1>
              <div className="subtitle">
                Interactive constraint analysis for The Update Framework augmentation proposals
              </div>
            </div>
          </div>
          <div className="header-badges">
            <span className="header-badge">{data.taps.length + data.incorporatedTaps.length} TAPs</span>
            <span className="header-badge">{data.tapInteractions.length} interactions</span>
            <span className="header-badge">{Object.keys(data.spec.constraints).length} constraints</span>
          </div>
        </div>

        <div className="header-description">
          <p>
            <a href="https://theupdateframework.io" target="_blank" rel="noopener noreferrer">The Update Framework (TUF)</a> is
            a <a href="https://www.linuxfoundation.org/projects" target="_blank" rel="noopener noreferrer">Linux Foundation</a> /
            {' '}<a href="https://www.cncf.io/projects/the-update-framework-tuf/" target="_blank" rel="noopener noreferrer">CNCF</a> graduated
            project that provides a framework for securing software update systems. TAPs (TUF Augmentation Proposals) are
            the mechanism for proposing changes to the specification.
          </p>
        </div>

        <nav className="header-links">
          <a href={data.spec.url} target="_blank" rel="noopener noreferrer">Specification v{data.spec.version}</a>
          <a href="https://theupdateframework.io" target="_blank" rel="noopener noreferrer">theupdateframework.io</a>
          <a href="https://github.com/theupdateframework/taps" target="_blank" rel="noopener noreferrer">TAP Repository</a>
          <a href="https://github.com/theupdateframework/specification" target="_blank" rel="noopener noreferrer">Spec Source</a>
          <a href="https://github.com/theupdateframework/python-tuf" target="_blank" rel="noopener noreferrer">Reference Impl</a>
          <a href="https://ssl.engineering.nyu.edu/papers/samuel_tuf_ccs2010.pdf" target="_blank" rel="noopener noreferrer">Original Paper</a>
        </nav>

        <div className="header-tags">
          <span className="tag">software supply chain</span>
          <span className="tag">secure updates</span>
          <span className="tag">key management</span>
          <span className="tag">delegated trust</span>
          <span className="tag">metadata signing</span>
          <span className="tag">rollback protection</span>
          <span className="tag">CNCF graduated</span>
          <span className="tag">Sigstore</span>
          <span className="tag">in-toto</span>
        </div>

        <div className="header-meta">
          <span>spec modified {data.spec.lastModified}</span>
          <span>editors: {data.spec.editors.join(', ')}</span>
        </div>

        <div className="header-active-bar">
          <span>{activeTaps.size} TAP{activeTaps.size !== 1 ? 's' : ''} active</span>
          {activeTaps.size > 0 && (
            <button className="clear-btn" onClick={() => setActiveTaps(new Set())}>clear all</button>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2>Incorporated into Spec</h2>
          {data.incorporatedTaps.map(tap => (
            <IncorporatedTapCard key={tap.tap} tap={tap} />
          ))}
          <h2>Toggle TAPs</h2>
          {data.taps.map(tap => (
            <TapCard
              key={tap.tap}
              tap={tap}
              active={activeTaps.has(tap.tap)}
              onToggle={() => toggleTap(tap.tap)}
              implementationCount={tapImplCounts.get(tap.tap) ?? 0}
            />
          ))}
        </aside>

        <main className="main">
          {depWarnings.map((w, i) => (
            <div key={i} className="dep-warning">
              <WarnIcon />
              TAP {w.tap} depends on TAP {w.missingDep} which is not enabled. Enable TAP {w.missingDep} for full effect.
            </div>
          ))}

          {activeTaps.size === 0 ? (
            <div className="empty-state">
              <h2>Enable TAPs to see constraint changes</h2>
              <p>Toggle TAPs in the sidebar to visualise how they modify the TUF specification.</p>
            </div>
          ) : (
            <>
              <div className="summary-bar">
                {stats.added > 0 && (
                  <div className="summary-stat">
                    <div className="stat-dot green" />
                    <span className="stat-count">{stats.added}</span> added
                  </div>
                )}
                {stats.relaxed > 0 && (
                  <div className="summary-stat">
                    <div className="stat-dot blue" />
                    <span className="stat-count">{stats.relaxed}</span> relaxed
                  </div>
                )}
                {stats.removed > 0 && (
                  <div className="summary-stat">
                    <div className="stat-dot red" />
                    <span className="stat-count">{stats.removed}</span> removed
                  </div>
                )}
                {stats.incompatible > 0 && (
                  <div className="summary-stat">
                    <div className="stat-dot amber" />
                    <span className="stat-count">{stats.incompatible}</span> incompatible
                  </div>
                )}
                <div className="summary-stat">
                  <div className={`stat-dot ${supportingImplCount > 0 ? 'green' : 'red'}`} />
                  <span className="stat-count">{supportingImplCount}</span> impl{supportingImplCount !== 1 ? 's' : ''} support{supportingImplCount === 1 ? 's' : ''} this
                </div>
              </div>
            </>
          )}

          <div className="section">
            <h2>Implementations ({data.implementations?.length ?? 0})</h2>
            {tierOrder.map(tier => {
              const tierImpls = implCoverage.filter(c => c.impl.tier === tier)
              if (tierImpls.length === 0) return null
              const sorted = activeTaps.size > 0
                ? [...tierImpls].sort((a, b) => b.supportedTaps.length - a.supportedTaps.length)
                : tierImpls
              return (
                <div key={tier} className="impl-tier-group">
                  <div className="impl-tier-label">{tierLabels[tier]}</div>
                  <div className="impl-grid">
                    {sorted.map(c => (
                      <ImplementationCard key={c.impl.id} coverage={c} hasActiveTaps={activeTaps.size > 0} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {activeTaps.size > 0 && (
            <>
              {activeInteractions.length > 0 && (
                <div className="section">
                  <h2><LinkIcon /> TAP Interactions ({activeInteractions.length})</h2>
                  <div className="interaction-grid">
                    {[...activeInteractions]
                      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
                      .map((interaction, i) => (
                        <InteractionCard key={i} interaction={interaction} />
                      ))}
                  </div>
                </div>
              )}

              {securityImpacts.length > 0 && (
                <div className="section">
                  <h2>Security Impact</h2>
                  {securityImpacts.map(tap => (
                    <div key={tap.tap} className="security-section">
                      <h3><ShieldIcon /> <a href={tap.url} target="_blank" rel="noopener noreferrer">TAP {tap.tap}</a>: {tap.title}</h3>
                      <p>{tap.securityImpact.description}</p>
                      <div className="mitigates-list">
                        {tap.securityImpact.mitigates.map(a => (
                          <span key={a} className="mitigates-badge">{a}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="section">
                <h2>Changed Constraints ({changedConstraints.length})</h2>
                <div className="constraint-grid">
                  {changedConstraints.map(c => (
                    <ConstraintCard key={c.id} constraint={c} />
                  ))}
                </div>
              </div>

              <div className="section">
                <h2>Unchanged Constraints ({unchangedConstraints.length})</h2>
                <div className="constraint-grid">
                  {unchangedConstraints.map(c => (
                    <ConstraintCard key={c.id} constraint={c} />
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
