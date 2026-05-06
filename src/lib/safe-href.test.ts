import { describe, it, expect } from 'vitest'
import { safeHref } from './safe-href'

describe('safeHref', () => {
  it('passes https URLs through', () => {
    expect(safeHref('https://example.com/foo')).toBe('https://example.com/foo')
  })

  it('passes http URLs through', () => {
    expect(safeHref('http://example.com')).toBe('http://example.com')
  })

  it('passes mailto URLs through', () => {
    expect(safeHref('mailto:foo@example.com')).toBe('mailto:foo@example.com')
  })

  it('rejects javascript: URIs', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
  })

  it('rejects data: URIs', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
  })

  it('rejects file: URIs', () => {
    expect(safeHref('file:///etc/passwd')).toBe('#')
  })

  it('returns # for undefined', () => {
    expect(safeHref(undefined)).toBe('#')
  })

  it('returns # for empty string', () => {
    expect(safeHref('')).toBe('#')
  })

  it('preserves fragment-only URLs', () => {
    expect(safeHref('#section')).toBe('#section')
  })

  it('preserves root-relative URLs', () => {
    expect(safeHref('/path')).toBe('/path')
  })

  it('rejects malformed URLs', () => {
    expect(safeHref('not a url')).toBe('#')
  })

  it('preserves URLs with query and fragment', () => {
    expect(safeHref('https://example.com/path?q=1#frag')).toBe('https://example.com/path?q=1#frag')
  })
})
