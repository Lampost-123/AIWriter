// One Check (the calm overhaul, 2026-10-19). Every way of asking for a check comes here: the top bar's Check, the Issues
// list's "Check this scene", the binder's row menus and the palette. It runs what applies to what Adam asked for: the
// consistency checks (facts, who knows what, timeline and place; voices, style and tone for a scene) with the free rules
// they always run, and the critic's craft notes on the scene or chapter when "Craft notes too" is on. A scene's check
// opens its Issues list beside the page, where it shows as it goes; a chapter's or the story's shows in the top bar's
// Check while Adam carries on, and ends in one note with Show (the Check room). Automatic checks (after a draft, on
// marking a scene done) are still the Automatic AI setting's, and never come here.
import { create } from 'zustand'
import { ALL_CHECKS, DONE_CHECKS } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { startCheck } from '@/features/consistency/checkStore'
import { setScope, startCritique } from '@/features/critique/critiqueStore'
import { showIssues } from '@/features/issues/issuesStore'

const CRAFT_KEY = 'aiwrite:check-craft'

function readCraft(): boolean {
  try {
    return globalThis.localStorage?.getItem(CRAFT_KEY) === '1'
  } catch {
    return false
  }
}

interface CheckPrefs {
  /** "Craft notes too": the critic reads the scene or chapter as well (it costs more, so it is off until Adam asks). */
  craft: boolean
  setCraft: (on: boolean) => void
}

/** Adam's choice for the next check, kept on this computer. */
export const useCheckPrefs = create<CheckPrefs>((set) => ({
  craft: readCraft(),
  setCraft: (craft) => {
    set({ craft })
    try {
      globalThis.localStorage?.setItem(CRAFT_KEY, craft ? '1' : '0')
    } catch {
      // Kept for this run of the app only.
    }
  }
}))

export type CheckScope = 'scene' | 'chapter' | 'story'

/** The chapter a scene is in (the open story's outline, else asked for). */
async function chapterOf(sceneId: ID, storyId: ID): Promise<ID | null> {
  const held = useOutlineStore.getState().outline
  const o = held && held.story.id === storyId ? held : await api.getOutline(storyId).catch(() => null)
  return o?.scenes.find((s) => s.id === sceneId)?.chapterId ?? null
}

/**
 * Checks the open scene, its chapter or the whole story (see the top of this file). `sceneId`/`storyId`: another scene or
 * story than the open one (the binder's row menus); `craft`: in place of Adam's "Craft notes too"; `show`: false to leave
 * the Issues list closed.
 */
export async function runCheck(
  scope: CheckScope,
  o: { sceneId?: ID; chapterId?: ID; storyId?: ID; craft?: boolean; show?: boolean } = {}
): Promise<void> {
  const a = useApp.getState()
  const storyId = o.storyId ?? a.storyId
  if (!storyId) return void toast('Open a story first, then check it.')
  const craft = o.craft ?? useCheckPrefs.getState().craft
  if (scope === 'story') {
    // The whole story: facts, who knows what and the timeline in every scene (voices and style too with craft notes on).
    await startCheck({ scope: 'story', id: storyId }, storyId, craft ? ALL_CHECKS : DONE_CHECKS)
    return
  }
  const sceneId = o.sceneId ?? a.sceneId
  if (scope === 'scene') {
    if (!sceneId) return void toast('Open a scene first, then check it.')
    if (o.show !== false) void showIssues(sceneId, 'all')
    if (craft) {
      setScope('scene')
      void startCritique({ scope: 'scene', id: sceneId })
    }
    await startCheck({ scope: 'scene', id: sceneId }, storyId)
    return
  }
  const chapterId = o.chapterId ?? (sceneId ? await chapterOf(sceneId, storyId) : null)
  if (!chapterId) return void toast('Open a scene in the chapter first, then check it.')
  if (craft) {
    setScope('chapter')
    void startCritique({ scope: 'chapter', id: chapterId })
  }
  await startCheck({ scope: 'chapter', id: chapterId }, storyId)
}
