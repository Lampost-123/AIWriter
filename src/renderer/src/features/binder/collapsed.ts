import { useCallback, useState } from 'react'
import type { ID } from '@shared/types'

// Which chapters are collapsed in the binder, remembered on this computer.
// Browser storage can be unavailable; the binder works without it.

const KEY = 'aiwrite.binder.collapsed'

function read(): Set<ID> {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(ids: Set<ID>): void {
  try {
    // Keep the list from growing forever as chapters come and go.
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-500)))
  } catch {
    // Not remembered this time; nothing else to do.
  }
}

export function useCollapsed(): { collapsed: Set<ID>; toggle: (id: ID, collapse?: boolean) => void } {
  const [collapsed, setCollapsed] = useState<Set<ID>>(read)
  const toggle = useCallback((id: ID, collapse?: boolean) => {
    setCollapsed((prev) => {
      const shouldCollapse = collapse ?? !prev.has(id)
      if (shouldCollapse === prev.has(id)) return prev
      const next = new Set(prev)
      if (shouldCollapse) next.add(id)
      else next.delete(id)
      write(next)
      return next
    })
  }, [])
  return { collapsed, toggle }
}
