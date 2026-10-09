// The first run's state in the window (milestone 6): which step of the setup shows (null: none), the world it
// sets up, and the sample world. Loaded once before the first frame, so the Welcome screen never flashes
// before the setup; each step is remembered in the main process as it shows (api.setSetupStep).

import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { SetupState, SetupStep } from '@shared/contracts/setup'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushBeforeWorldChange } from '@/lib/flush'
import { useApp } from '@/lib/store'

interface SetupStore {
  /** Known (or given up on): the window can show its first frame. */
  ready: boolean
  step: SetupStep | null
  worldId: ID | null
  sampleWorldId: ID | null
  /**
   * The New look: the setup is ending and its last moment is playing (the lamp lit, "The lamp is lit" on the sheet)
   * before the first scene ('write') or the World builder ('build') opens.
   */
  finishing: false | 'write' | 'build'
  /** Where the first run stands at launch. Never throws: without it the app starts as it always did. */
  load(): Promise<void>
  apply(state: SetupState): void
  /** Shows a step and remembers it, so the next launch resumes there. */
  go(step: SetupStep): Promise<void>
  /** The setup steps aside (the workspace or the Welcome screen shows). */
  close(): void
}

export const useSetup = create<SetupStore>((set, get) => ({
  ready: false,
  step: null,
  worldId: null,
  sampleWorldId: null,
  finishing: false,

  async load() {
    try {
      get().apply(await api.getSetup())
    } catch (e) {
      console.warn('Could not read the first-run state', e)
    } finally {
      set({ ready: true })
    }
  },

  apply(state) {
    set({ step: state.step, worldId: state.worldId, sampleWorldId: state.sampleWorldId })
  },

  async go(step) {
    set({ step })
    try {
      get().apply(await api.setSetupStep(step))
    } catch (e) {
      // Only remembering the place failed: the step still shows.
      console.warn('Could not remember the setup step', e)
    }
  },

  close() {
    set({ step: null, finishing: false })
  }
}))

// The sample world can be opened from the world list too: whenever another world opens, ask whether it is the sample
// (launch only looks at the world it reopened, so a slow library never holds up the window).
useApp.subscribe((s, prev) => {
  const id = s.world?.id
  if (!id || id === prev.world?.id || id === useSetup.getState().sampleWorldId) return
  api
    .sampleWorldOpen()
    .then((sample) => {
      if (sample) useSetup.setState({ sampleWorldId: sample })
    })
    .catch(() => undefined)
})

/**
 * Opens the sample world (making it the first time), from the first run, the Welcome screen, the world switcher
 * or the palette. Anything unsaved in the open world is saved first.
 */
export async function openSampleWorld(): Promise<void> {
  try {
    await flushBeforeWorldChange()
    const world = await api.openSampleWorld()
    await useApp.getState().openWorld(world.id)
    useSetup.setState({ step: null, sampleWorldId: world.id })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

/**
 * "Start my own world" (from the sample world): resumes or starts the first-run setup while Adam has no world of
 * his own, else opens the New world dialog.
 */
export async function startOwnWorld(openNewWorld: () => void): Promise<void> {
  try {
    await flushBeforeWorldChange()
    const state = await api.startSetup()
    if (!state.step) return openNewWorld()
    // A setup under way resumes in its own world (opened in the main process for it).
    if (state.worldId && useApp.getState().world?.id !== state.worldId) await useApp.getState().openWorld(state.worldId)
    useSetup.getState().apply(state)
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}
