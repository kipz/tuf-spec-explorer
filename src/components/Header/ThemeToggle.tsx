import { SunIcon, MoonIcon } from '../../icons'

interface Props {
  theme: 'light' | 'dark'
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: Props) {
  const next = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
