// Whether entry pages show the entry as of a point in the story (read-only) rather than its profile
// to edit, and which point. Kept while Adam moves between entries, so he can compare them at the
// same scene; going to another page or world starts again from editing.

import { create } from 'zustand'
import type { AsOf, ID } from '@shared/types'
import { useApp } from '@/lib/store'

interface AsOfMode {
  on: boolean
  /** The point chosen on the slider; null for the scene Adam is working in. */
  at: AsOf | null
  /** The story whose line it is seen along ("As seen in"); null for the story Adam is working in. */
  seenIn: ID | null
}

export const useAsOfMode = create<AsOfMode>(() => ({ on: false, at: null, seenIn: null }))

export const setAsOfMode = (patch: Partial<AsOfMode>): void => useAsOfMode.setState(patch)

useApp.subscribe((s, prev) => {
  if (s.world?.id !== prev.world?.id || (s.view !== prev.view && s.view.kind !== 'entries')) useAsOfMode.setState({ on: false, at: null, seenIn: null })
})
