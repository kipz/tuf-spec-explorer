import type { SpecData } from '../../types'
import { safeHref } from '../../lib/safe-href'
import { TufLogo } from '../../icons/TufLogo'
import { GitHubIcon, SlackIcon } from '../../icons'
import { ThemeToggle } from './ThemeToggle'
import { DisclaimerBanner } from './DisclaimerBanner'

const TAGS = [
  'software supply chain',
  'secure updates',
  'key management',
  'delegated trust',
  'metadata signing',
  'rollback protection',
  'CNCF graduated',
  'Sigstore',
  'in-toto',
]

interface Props {
  data: SpecData
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  disclaimerDismissed: boolean
  onDismissDisclaimer: () => void
  activeTapsCount: number
  onClearTaps: () => void
}

export function Header({
  data,
  theme,
  onThemeToggle,
  disclaimerDismissed,
  onDismissDisclaimer,
  activeTapsCount,
  onClearTaps,
}: Props) {
  return (
    <>
      {!disclaimerDismissed && (
        <DisclaimerBanner specUrl={data.spec.url} onDismiss={onDismissDisclaimer} />
      )}
      <header>
        <div className="header-top">
          <div className="header-branding">
            <div className="tuf-logo">
              <TufLogo />
            </div>
            <div>
              <h1>TUF Spec Explorer</h1>
              <div className="subtitle">
                Interactive constraint analysis for The Update Framework augmentation proposals
              </div>
            </div>
          </div>
          <div className="header-badges">
            <span className="header-badge">
              {data.taps.length + data.incorporatedTaps.length} TAPs
            </span>
            <span className="header-badge">{data.tapInteractions.length} interactions</span>
            <span className="header-badge">
              {Object.keys(data.spec.constraints).length} constraints
            </span>
            <a
              href="https://cloud-native.slack.com/archives/C8NMD3QJ3"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
              aria-label="TUF Slack channel"
              title="TUF Slack channel"
            >
              <SlackIcon />
            </a>
            <a
              href="https://github.com/kipz/tuf-spec-explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
              aria-label="View source on GitHub"
              title="View source on GitHub"
            >
              <GitHubIcon />
            </a>
            <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          </div>
        </div>

        <div className="header-description">
          <p>
            <a href="https://theupdateframework.io" target="_blank" rel="noopener noreferrer">
              The Update Framework (TUF)
            </a>{' '}
            is a{' '}
            <a
              href="https://www.linuxfoundation.org/projects"
              target="_blank"
              rel="noopener noreferrer"
            >
              Linux Foundation
            </a>{' '}
            /{' '}
            <a
              href="https://www.cncf.io/projects/the-update-framework-tuf/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CNCF
            </a>{' '}
            graduated project that provides a framework for securing software update systems. TAPs
            (TUF Augmentation Proposals) are the mechanism for proposing changes to the
            specification.
          </p>
        </div>

        <nav className="header-links" aria-label="External resources">
          <a href={safeHref(data.spec.url)} target="_blank" rel="noopener noreferrer">
            Specification v{data.spec.version}
          </a>
          <a href="https://theupdateframework.io" target="_blank" rel="noopener noreferrer">
            theupdateframework.io
          </a>
          <a
            href="https://github.com/theupdateframework/taps"
            target="_blank"
            rel="noopener noreferrer"
          >
            TAP Repository
          </a>
          <a
            href="https://github.com/theupdateframework/specification"
            target="_blank"
            rel="noopener noreferrer"
          >
            Spec Source
          </a>
          <a
            href="https://github.com/theupdateframework/python-tuf"
            target="_blank"
            rel="noopener noreferrer"
          >
            Reference Impl
          </a>
          <a
            href="https://ssl.engineering.nyu.edu/papers/samuel_tuf_ccs2010.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            Original Paper
          </a>
        </nav>

        <div className="header-tags">
          {TAGS.map(tag => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="header-meta">
          <span>spec modified {data.spec.lastModified}</span>
          <span>editors: {data.spec.editors.join(', ')}</span>
        </div>

        <div className="header-active-bar" aria-live="polite" aria-atomic="true">
          <span>
            {activeTapsCount} TAP{activeTapsCount !== 1 ? 's' : ''} selected
          </span>
          {activeTapsCount > 0 && (
            <button className="clear-btn" onClick={onClearTaps}>
              clear all
            </button>
          )}
        </div>
      </header>
    </>
  )
}
