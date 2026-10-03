// Which export dialog is open (milestone 6, World files and export). The dialogs are mounted once in the
// workspace (ExportDialogs.tsx); the story menu and the command palette open them through here.

import { create } from 'zustand'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'

interface ExportState {
  /** Export story…: the story, and the chapter to start on (the open scene's) when there is one. */
  story: { storyId: ID; chapterId: ID | null } | null
  /** Export series bible…: as of this story's end. */
  bible: { storyId: ID } | null
}

export const useExportDialogs = create<ExportState>(() => ({ story: null, bible: null }))

export const openExportStory = (storyId: ID, chapterId: ID | null = null): void =>
  useExportDialogs.setState({ story: { storyId, chapterId }, bible: null })

export const openExportBible = (storyId: ID): void => useExportDialogs.setState({ bible: { storyId }, story: null })

/** The open scene's chapter (from the binder's outline), so "One chapter" starts there. */
export function currentChapterId(): ID | null {
  const { sceneId } = useApp.getState()
  return useOutlineStore.getState().outline?.scenes.find((s) => s.id === sceneId)?.chapterId ?? null
}

/** A choice remembered on this computer only (the last format picked); never needed for anything to work. */
export function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private window or storage turned off: it just isn't remembered */
  }
}
