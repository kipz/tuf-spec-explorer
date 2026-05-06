import { useEffect, useState } from 'react'

export function useLocalStorage<T>(
  key: string,
  initial: T,
  serialize: (v: T) => string = JSON.stringify,
  deserialize: (s: string) => T = JSON.parse,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const stored = window.localStorage.getItem(key)
      return stored !== null ? deserialize(stored) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, serialize(value))
    } catch {
      // Storage may be full, disabled, or unavailable. Drop silently.
    }
  }, [key, value, serialize])

  return [value, setValue]
}
