// A change to an entry in plain words, for the scene card's "What this scene should bring about".
// Pure, so it is unit-tested.

import type { Change, ID } from '@shared/types'

const clean = (s: string | undefined): string => (s ?? '').trim().replace(/[.\s]+$/, '')

/**
 * "Mara: loses her left hand", "Mara and Tobin: rivals", "Tobin learns: Mara is the heir",
 * "The missing ring is resolved: found in the well". `nameOf` gives an entry's name.
 */
export function describeChange(change: Change, nameOf: (id: ID) => string): string {
  const name = nameOf(change.entryId)
  switch (change.kind) {
    case 'update': {
      const note = clean(change.payload.note)
      return note ? `${name}: ${note}` : `${name}: changes`
    }
    case 'full':
      return `${name}: starts this story as newly described`
    case 'relationship': {
      const other = nameOf(change.payload.otherId)
      const type = clean(change.payload.type)
      if (change.payload.ended) return type ? `${name} and ${other}: no longer ${type}` : `${name} and ${other}: their bond ends`
      return type ? `${name} and ${other}: ${type}` : `${name} and ${other}: a new bond`
    }
    case 'knowledge': {
      const fact = clean(change.payload.fact)
      return `${name} ${change.payload.forgets ? 'forgets' : change.payload.seen ? 'sees it happen' : 'learns'}: ${fact}`
    }
    case 'thread': {
      const note = clean(change.payload.note)
      const what = change.payload.status === 'open' ? `${name} opens` : `${name} is resolved`
      return note ? `${what}: ${note}` : what
    }
  }
}
