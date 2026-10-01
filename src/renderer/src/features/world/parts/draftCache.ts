/**
 * Remembers the newest local copy of a form's data until it is confirmed saved,
 * so a form that closes and re-opens before its last write lands (switching tabs
 * quickly) starts from what Adam typed, not from older data.
 */
export function createDraftCache<T>(): {
  get(key: string): T | undefined
  set(key: string, value: T): void
  confirm(key: string, value: T): void
} {
  const m = new Map<string, T>()
  return {
    get: (key) => m.get(key),
    set: (key, value) => void m.set(key, value),
    confirm: (key, value) => {
      if (m.get(key) === value) m.delete(key)
    }
  }
}
