// Whether the first-run setup shows, and at which step (milestone 6). Pure, so it is unit-tested; the
// handlers in src/main/ipc/setup.ts give it the library, the settings and the open world.

import type { FirstRun, ID } from '@shared/types'
import type { SetupStep } from '@shared/contracts/setup'

export interface SetupFacts {
  /** AIWRITE_SETUP=off (the app tests that aren't about the setup): a library with no worlds shows the Welcome screen. */
  off: boolean
  /** The library folder can be reached (when it can't, the Welcome screen says so instead). */
  reachable: boolean
  firstRun: FirstRun | null | undefined
  /** The world open now. */
  openWorldId: ID | null
  /** Every world in the library. */
  worldIds: ID[]
  /** Those that are the sample world. */
  sampleIds: ID[]
}

/** The setup's step to show, and the world it sets up; step null when it doesn't show. */
export function setupAt(f: SetupFacts): { step: SetupStep | null; worldId: ID | null } {
  const none = { step: null, worldId: null }
  if (!f.reachable) return none
  const run = resumable(f)
  // A setup under way resumes with its own world (opened for it when no world is open). With another world
  // open (Adam went to look at the sample world), it waits for "Start my own world".
  if (run) return f.openWorldId === null || f.openWorldId === run.worldId ? run : none
  if (f.off) return none
  // A fresh library: nothing of Adam's own yet, and no world open.
  return f.openWorldId === null && !ownWorlds(f) ? { step: 'world', worldId: null } : none
}

/** "Start my own world": the setup under way, else the first step while Adam has no world of his own; else none. */
export function startAt(f: SetupFacts): { step: SetupStep | null; worldId: ID | null } {
  if (!f.reachable) return { step: null, worldId: null }
  return resumable(f) ?? (ownWorlds(f) ? { step: null, worldId: null } : { step: 'world', worldId: null })
}

/** A setup under way whose world is still in the library. */
function resumable(f: SetupFacts): { step: SetupStep; worldId: ID } | null {
  const r = f.firstRun
  if (!r || r.step === 'guide' || !r.worldId || !f.worldIds.includes(r.worldId)) return null
  return { step: r.step, worldId: r.worldId }
}

const ownWorlds = (f: SetupFacts): number => f.worldIds.filter((id) => !f.sampleIds.includes(id)).length
