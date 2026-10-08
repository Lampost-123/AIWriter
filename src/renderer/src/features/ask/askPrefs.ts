// The Ask panel's small choices (chat overhaul Phase 2): how dense it is (Comfortable or Compact, from the ⋯ menu in
// its head, remembered on this computer like Generate's "Polish after drafting"), and what Adam made of each option
// card (kept ★, used as a beat, set aside). Since chat Phase 4 an option card's state is kept with its answer's record
// too (setOptionMark), and read back with the chat's turns, so it shows again after a restart.
import { create } from 'zustand'
import type { AskTurn, OptionMark } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'

export type Density = 'comfortable' | 'compact'

const DENSITY_KEY = 'aiwrite.ask.density'

export function lastDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

/** What Adam made of one option card. */
export type OptionState = OptionMark

/** How each answer's tool calls show once it has ended (chat Phase 2b): folded to one line, or always listed. */
export type ToolsView = 'folded' | 'open'

const TOOLS_KEY = 'aiwrite.ask.tools'

export function lastToolsView(): ToolsView {
  try {
    return localStorage.getItem(TOOLS_KEY) === 'open' ? 'open' : 'folded'
  } catch {
    return 'folded'
  }
}

interface PrefsState {
  density: Density
  toolsView: ToolsView
  options: Record<string, OptionState>
}

export const useAskPrefs = create<PrefsState>(() => ({ density: lastDensity(), toolsView: lastToolsView(), options: {} }))

export function setToolsView(toolsView: ToolsView): void {
  useAskPrefs.setState({ toolsView })
  try {
    localStorage.setItem(TOOLS_KEY, toolsView)
  } catch {
    // Remembering it is only a convenience.
  }
}

export function setDensity(density: Density): void {
  useAskPrefs.setState({ density })
  try {
    localStorage.setItem(DENSITY_KEY, density)
  } catch {
    // Remembering it is only a convenience.
  }
}

/** An option card's key: its answer's record and its place in the answer. */
export const optionKey = (generationId: ID, index: number): string => `${generationId}:${index}`

/** The answer's record and the card's number from an option card's key; null for an answer not recorded yet. */
export function optionOfKey(key: string): { generationId: ID; card: number } | null {
  const i = key.lastIndexOf(':')
  const generationId = key.slice(0, i)
  const card = Number(key.slice(i + 1))
  if (i <= 0 || generationId.startsWith('pending:') || !Number.isInteger(card) || card < 1) return null
  return { generationId, card }
}

/** Changes what Adam made of an option card: shown at once, and kept with the answer's record. */
export function setOption(key: string, patch: Partial<OptionState>): void {
  const options = useAskPrefs.getState().options
  const next = { ...options[key], ...patch }
  useAskPrefs.setState({ options: { ...options, [key]: next } })
  const at = optionOfKey(key)
  if (at) void api.setOptionMark(at.generationId, at.card, next).catch(() => undefined)
}

/** The option card states kept with turns' records (read with a chat), under those changed this session. */
export function rememberOptions(turns: Pick<AskTurn, 'generationId' | 'options'>[]): void {
  const kept: Record<string, OptionState> = {}
  for (const t of turns) for (const [card, mark] of Object.entries(t.options ?? {})) kept[`${t.generationId}:${card}`] = mark
  if (!Object.keys(kept).length) return
  useAskPrefs.setState({ options: { ...kept, ...useAskPrefs.getState().options } })
}
