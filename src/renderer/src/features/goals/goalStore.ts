// Writing by hand: the words written each day (typed, and AI words kept), kept in settings.goals.days on this
// computer only, never in a world. Counted as the page changes (wordTally.ts); saved a few seconds after the last
// change, and before the window closes.
import { create } from 'zustand'
import type { WritingDay } from '@shared/types'
import { registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { addWords as addToDays, localDate, type DayTally } from './goalLogic'
import { setWordSink, type WordDelta } from './wordTally'

/** How long after a change the days are saved (at most this often while Adam writes). */
const SAVE_AFTER_MS = 4000

interface GoalState {
  /** Null until read from the settings. */
  days: WritingDay[] | null
  /** Today's date, kept current so the counts move on at midnight. */
  today: string
}

export const useGoals = create<GoalState>(() => ({ days: null, today: localDate() }))

let timer: ReturnType<typeof setTimeout> | null = null
/** Each day's running totals this session (see addWords in goalLogic.ts). */
let running: DayTally['running'] = {}
let dirty = false

async function save(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const days = useGoals.getState().days
  if (!dirty || !days) return
  dirty = false
  try {
    await useApp.getState().updateSettings({ goals: { days } })
  } catch {
    // Tried again with the next change, or on closing.
    dirty = true
  }
}

/** The days as stored, read once the settings are there. */
function daysFromSettings(): WritingDay[] | null {
  const d = useApp.getState().settings?.goals?.days
  return d ? d.filter((x) => x && typeof x.date === 'string') : null
}

/** Adds counted words to their day. */
export function addWords(d: WordDelta): void {
  const today = localDate()
  const days = useGoals.getState().days ?? daysFromSettings()
  if (!days) return
  const next = addToDays({ days, running }, d.day ?? today, d.typed, d.ai, today)
  running = next.running
  useGoals.setState({ days: next.days, today })
  dirty = true
  if (!timer) timer = setTimeout(() => void save(), SAVE_AFTER_MS)
}

/** Starts counting (once, from App). Returns a function that stops it. */
export function installGoals(): () => void {
  setWordSink(addWords, () => localDate())
  const load = (): void => {
    if (useGoals.getState().days === null) {
      const days = daysFromSettings()
      if (days) useGoals.setState({ days })
    }
  }
  load()
  const offApp = useApp.subscribe(load)
  const offFlush = registerFlusher(save)
  // Midnight: today's counts start again (checked every minute).
  const tick = setInterval(() => {
    const today = localDate()
    if (useGoals.getState().today !== today) useGoals.setState({ today })
  }, 60_000)
  return () => {
    setWordSink(null, () => localDate())
    offApp()
    offFlush()
    clearInterval(tick)
    void save()
  }
}
