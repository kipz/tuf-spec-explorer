const SAFE_SCHEMES = ['https:', 'http:', 'mailto:']

export function safeHref(url: string | undefined): string {
  if (!url) return '#'
  try {
    const parsed = new URL(url, 'https://placeholder.invalid')
    if (parsed.origin === 'https://placeholder.invalid') {
      return url.startsWith('#') || url.startsWith('/') ? url : '#'
    }
    if (SAFE_SCHEMES.includes(parsed.protocol)) return url
    return '#'
  } catch {
    return '#'
  }
}
