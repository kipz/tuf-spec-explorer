import { safeHref } from '../../lib/safe-href'
import { WarnIcon, CloseIcon } from '../../icons'

interface Props {
  specUrl: string
  onDismiss: () => void
}

export function DisclaimerBanner({ specUrl, onDismiss }: Props) {
  return (
    <div className="disclaimer-banner">
      <span className="disclaimer-icon">
        <WarnIcon />
      </span>
      <span className="disclaimer-text">
        The TAP and constraint data on this site is generated and curated with the assistance of an
        LLM. It is intended as a guide only and may contain mistakes, omissions, or inaccuracies.
        Always verify against the{' '}
        <a href={safeHref(specUrl)} target="_blank" rel="noopener noreferrer">
          official specification
        </a>{' '}
        and{' '}
        <a
          href="https://github.com/theupdateframework/taps"
          target="_blank"
          rel="noopener noreferrer"
        >
          TAP repository
        </a>
        .
      </span>
      <button
        className="disclaimer-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss disclaimer"
        title="Dismiss"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
