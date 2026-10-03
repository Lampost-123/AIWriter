// Where this month's spending stands against the limit (milestone 6, Usage and cost), as the main process last
// said ('usage:spend'), and "Carry on this month" for the toasts, the ask and the page.

import { create } from 'zustand'
import type { SpendState } from '@shared/contracts/usage'
import { api } from '@/lib/api'

export const useSpend = create<{ state: SpendState | null }>(() => ({ state: null }))

export const setSpend = (state: SpendState): void => useSpend.setState({ state })

/** Carries on this month; the new state is kept. Throws the plain-words reason when it can't. */
export async function carryOn(): Promise<SpendState> {
  const s = await api.carryOnThisMonth()
  setSpend(s)
  return s
}
