// Running what the command palette offers: its actions (paletteLogic.ts lists them) and opening a
// search result. Each uses the app's own way of doing it (the binder's actions, the entry pages,
// the Generate button's shortcut), so the palette never does anything differently from the rest.

import type { EntryKind, ID, Outline } from '@shared/types'
import type { SearchOpen } from '@shared/contracts/search'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { pressShortcut } from '@/lib/shortcuts'
import { useApp, type SettingsTab } from '@/lib/store'
import * as binder from '@/features/binder/actions'
import { lastSceneOf } from '@/features/binder/lastScene'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { markSceneDone, reopenScene } from '@/features/editor/markDone'
import { requestReveal } from '@/features/editor/reveal'
import { openStorySettings } from '@/features/stories/storyActions'
import { createEntry } from '@/features/world/entryActions'
import { toggleFloatingBinder, useFloatingBinder } from '@/layout/ResizablePane'
import { openHistory } from '@/features/history/open'
import { openVariants } from '@/features/variants/open'
import { startBeatByBeat } from '@/features/beats/start'
import { continueFromCursor } from '@/features/edits/continue'
import { openAsk } from '@/features/ask/open'
import { openChapterInterview, openOutlineHelper } from '@/features/outline/open'
import { showSceneIdeas, showSceneInterview } from '@/features/outline/ideas'
import { stopReading, toggleListen } from '@/features/readAloud/control'
import { setShowSpeakers } from '@/features/readAloud/SpeakersButton'
import { insertSceneBreak, pasteAsPlainText, toggleBlockQuote, toggleBold, toggleItalic } from '@/features/typing/format'
import { openFindInScene, openFindInStory } from '@/features/find/open'
import { openWordCounts } from '@/features/goals/WordCounts'
import { openWorldBuilder } from '@/features/worldBuilder/open'
import { checkChapter, checkScene, checkStory, openConsistency } from '@/features/consistency/checkStore'
import { currentChapterId, openExportBible, openExportStory } from '@/features/transfer/exportStore'
import { copyWorld, exportWorld, importWorld } from '@/features/transfer/worldFiles'
import { offerMemory, startImport } from '@/features/importing/importStore'
import { enterFocus, leaveFocus } from '@/features/look/focusMode'
import { openSampleWorld } from '@/features/setup/setupStore'
import { goToStartScreen } from '@/features/start/home'
import { revealCardPart } from './cardReveal'
import { revealEntryPart } from './entryReveal'
import { entryAction, type ActionId, type FixedActionId } from './paletteLogic'
import { openShortcuts, openWorldMenu, startRenamingWorld, usePalette } from './paletteStore'

const app = useApp.getState

const failed = (e: unknown): void => void toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })

/** The open story's outline (the binder's copy when it has it). */
async function outlineOf(storyId: ID): Promise<Outline> {
  const o = useOutlineStore.getState().outline
  return o && o.story.id === storyId ? o : api.getOutline(storyId)
}

/** A new scene after the open one (else at the end of the story), opened with the caret in the page. */
async function newScene(): Promise<void> {
  const storyId = app().storyId
  if (!storyId) return
  const o = await outlineOf(storyId)
  const open = o.scenes.find((s) => s.id === app().sceneId)
  let chapterId: ID | null = open?.chapterId ?? o.chapters[o.chapters.length - 1]?.id ?? null
  if (!chapterId) chapterId = await binder.addChapter(storyId)
  if (!chapterId) return
  const id = await binder.addScene(chapterId, open?.id ?? null)
  if (id) requestEditorFocus(id)
}

/** A new chapter after the open scene's (else at the end), with a first scene to write in. */
async function newChapter(): Promise<void> {
  const storyId = app().storyId
  if (!storyId) return
  const o = await outlineOf(storyId)
  const after = o.scenes.find((s) => s.id === app().sceneId)?.chapterId ?? null
  const chapterId = await binder.addChapter(storyId, after)
  if (!chapterId) return
  const id = await binder.addScene(chapterId)
  if (id) requestEditorFocus(id)
}

async function newEntry(kind: EntryKind): Promise<void> {
  const entry = await createEntry(kind)
  app().navigate({ kind: 'entries', entryKind: kind, entryId: entry.id })
}

/**
 * Back to the writing page from another one, for an action on its scene, with the caret in the page
 * (as when the binder opens a scene), not on whatever had the focus before.
 */
function backToWriting(): void {
  const a = app()
  if (a.view.kind === 'write') return
  if (a.sceneId) requestEditorFocus(a.sceneId)
  a.navigate({ kind: 'write' })
}

type SettingsAction = Extract<FixedActionId, `settings-${string}`>

const SETTINGS: Record<SettingsAction, SettingsTab> = {
  'settings-models': 'models',
  'settings-preferences': 'preferences',
  'settings-appearance': 'appearance',
  'settings-backups': 'backups',
  'settings-trash': 'trash',
  'settings-about': 'about',
  'settings-speech': 'speech',
  'settings-usage': 'usage',
  'settings-editor': 'editor'
}

/** Runs one of the palette's actions. */
export async function runAction(id: ActionId): Promise<void> {
  // From the start screen, an action happens in the workspace, so that shows first.
  if (id !== 'start-screen' && app().home) app().leaveHome()
  const a = app()
  const entry = entryAction(id)
  try {
    if (entry) {
      if (entry.verb === 'go') a.navigate({ kind: 'entries', entryKind: entry.kind, entryId: null })
      else await newEntry(entry.kind)
      return
    }
    const fixed = id as FixedActionId
    const layout = a.settings?.layout
    switch (fixed) {
      case 'generate':
        // The Generate button acts on its shortcut, on the writing page.
        backToWriting()
        pressShortcut('generate')
        return
      case 'stop':
        if (a.activeGeneration) {
          await api.stopGeneration(a.activeGeneration.id)
          return
        }
        // A draft still getting ready (the memory catching up first) has nothing to stop yet: Esc on
        // the writing page calls it off, as the Stop button does.
        backToWriting()
        pressShortcut('stop')
        return
      case 'mark-done':
        if (!a.sceneId) return
        backToWriting()
        await markSceneDone(a.sceneId)
        return
      case 'reopen-scene':
        if (!a.sceneId) return
        backToWriting()
        await reopenScene(a.sceneId)
        return
      case 'new-scene':
        return await newScene()
      case 'new-chapter':
        return await newChapter()
      case 'new-story':
        a.setNewStoryOpen(true)
        return
      case 'delete-scene':
        if (a.sceneId) await binder.deleteScene(a.sceneId)
        return
      case 'go-write':
        a.navigate({ kind: 'write' })
        return
      case 'go-codex':
        a.navigate({ kind: 'codex' })
        return
      case 'go-timeline':
        a.navigate({ kind: 'timeline' })
        return
      case 'go-map':
        a.navigate({ kind: 'map' })
        return
      case 'go-threads':
        a.navigate({ kind: 'threads' })
        return
      case 'go-style':
        a.navigate({ kind: 'style' })
        return
      case 'go-memory':
        a.navigate({ kind: 'memory', sceneId: null })
        return
      case 'go-story':
        if (a.storyId) openStorySettings(a.storyId)
        return
      case 'quick-character':
        a.navigate({ kind: 'builder', entryKind: 'character', entryId: null, start: { mode: 'quick' } })
        return
      case 'theme-light':
      case 'theme-dark':
      case 'theme-sepia':
      case 'theme-system':
        await a.updateSettings({ theme: fixed.slice('theme-'.length) as 'light' | 'dark' | 'sepia' | 'system' })
        return
      case 'toggle-binder':
        // In a small window the binder floats over the page: this shows or hides it and leaves the saved layout alone.
        if (useFloatingBinder.getState().floating) toggleFloatingBinder()
        else if (layout) await a.updateSettings({ layout: { binderOpen: !layout.binderOpen } })
        return
      case 'toggle-panel':
        if (layout) await a.updateSettings({ layout: { inspectorOpen: !layout.inspectorOpen } })
        return
      case 'backup-now':
        await flushAll()
        await api.backupNow()
        toast('Backed up. Find every backup in Settings › Backups.', { tone: 'success' })
        return
      case 'new-world':
        usePalette.setState({ newWorld: true })
        return
      case 'switch-world':
        openWorldMenu()
        return
      case 'rename-world':
        startRenamingWorld()
        return
      case 'shortcuts':
        openShortcuts()
        return
      case 'settings-models':
      case 'settings-preferences':
      case 'settings-appearance':
      case 'settings-backups':
      case 'settings-trash':
      case 'settings-about':
      case 'settings-speech':
      case 'settings-usage':
      case 'settings-editor':
        a.navigate({ kind: 'settings', tab: SETTINGS[fixed] })
        return
      // ----- Milestone 4 -----
      case 'variants':
        if (a.sceneId) openVariants(a.sceneId)
        return
      case 'beat-by-beat':
        if (!a.sceneId) return
        backToWriting()
        startBeatByBeat(a.sceneId)
        return
      case 'history':
        if (a.sceneId) await openHistory(a.sceneId)
        return
      case 'continue':
        backToWriting()
        continueFromCursor()
        return
      case 'ask-world':
        openAsk()
        return
      case 'outline-helper':
        if (a.storyId) openOutlineHelper(a.storyId)
        return
      case 'scene-ideas':
        if (!a.sceneId) return
        backToWriting()
        showSceneIdeas(a.sceneId)
        return
      case 'scene-interview':
        if (!a.sceneId) return
        backToWriting()
        showSceneInterview(a.sceneId)
        return
      case 'chapter-interview': {
        const o = useOutlineStore.getState().outline
        const chapterId = o?.scenes.find((sc) => sc.id === a.sceneId)?.chapterId
        if (o && chapterId) openChapterInterview(o.story.id, chapterId)
        return
      }
      case 'listen':
        backToWriting()
        toggleListen()
        return
      case 'stop-reading':
        stopReading()
        return
      case 'show-speakers':
      case 'hide-speakers':
        await setShowSpeakers(fixed === 'show-speakers')
        return
      case 'world-builder':
        openWorldBuilder()
        return
      // ----- Milestone 5 -----
      case 'check-scene':
        if (a.sceneId && a.storyId) await checkScene(a.sceneId, a.storyId)
        return
      case 'check-chapter': {
        if (!a.sceneId || !a.storyId) return
        const chapterId = (await outlineOf(a.storyId)).scenes.find((s) => s.id === a.sceneId)?.chapterId
        if (chapterId) await checkChapter(chapterId, a.storyId)
        return
      }
      case 'check-story': {
        // On a story's Consistency page, that story.
        const storyId = a.view.kind === 'consistency' ? a.view.storyId : a.storyId
        if (storyId) await checkStory(storyId)
        return
      }
      case 'go-consistency':
        if (a.storyId) openConsistency(a.storyId)
        return
      // ----- Milestone 6 -----
      case 'export-story':
        if (a.storyId) openExportStory(a.storyId, currentChapterId())
        return
      case 'export-bible':
        if (a.storyId) openExportBible(a.storyId)
        return
      case 'export-world':
        await exportWorld()
        return
      case 'copy-world':
        await copyWorld()
        return
      case 'import-world':
        await importWorld()
        return
      case 'import-manuscript':
        startImport()
        return
      case 'build-memory':
        if (a.storyId) offerMemory(a.storyId)
        return
      case 'focus-mode':
        enterFocus()
        return
      case 'leave-focus-mode':
        leaveFocus()
        return
      case 'sample-world':
        await openSampleWorld()
        return
      case 'start-screen':
        goToStartScreen()
        return
      // ----- Writing by hand -----
      case 'bold':
        toggleBold()
        return
      case 'italic':
        toggleItalic()
        return
      case 'block-quote':
        toggleBlockQuote()
        return
      case 'scene-break':
        insertSceneBreak()
        return
      case 'paste-plain':
        await pasteAsPlainText()
        return
      case 'find-scene':
        openFindInScene()
        return
      case 'find-story':
        openFindInStory()
        return
      case 'spell-check-on':
      case 'spell-check-off':
        await a.updateSettings({ editor: { spellCheck: fixed === 'spell-check-on' } })
        toast(fixed === 'spell-check-on' ? 'Spell check is on.' : 'Spell check is off. Settings › Editor turns it back on.')
        return
      case 'word-counts':
        if (a.view.kind !== 'write') a.navigate({ kind: 'write' })
        // After the palette has closed and given the keyboard back.
        setTimeout(openWordCounts, 0)
        return
      default: {
        const unknown: never = fixed
        throw new Error(`Unknown action ${String(unknown)}`)
      }
    }
  } catch (e) {
    failed(e)
  }
}

/** Opens a search result: a scene (at the words, when it has them), an entry, a story or the style guide. */
export async function openResult(open: SearchOpen): Promise<void> {
  if (app().home) app().leaveHome()
  const a = app()
  try {
    switch (open.kind) {
      case 'scene':
        // Asked for before the scene opens: the editor selects the words (or puts the caret in the page) once it shows.
        if (open.words) requestReveal(open.sceneId, open.words)
        else requestEditorFocus(open.sceneId)
        if (open.card) {
          // The scene panel shows the card (not an entry looked at beside the page), at the part found.
          a.setInspectorTab('card')
          a.peekEntry(null)
          if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
        }
        a.selectScene(open.sceneId, open.storyId)
        if (open.card) revealCardPart(open.sceneId, open.card)
        return
      case 'entry':
        a.navigate({ kind: 'entries', entryKind: open.entryKind, entryId: open.entryId })
        // Found further down its page (a field, its private notes, what the memory has): the page opens there.
        if (open.part) revealEntryPart(open.entryId, open.entryKind, open.part, open.words)
        return
      case 'story': {
        // Where Adam last was in that story, else its first scene (as the story switcher does).
        let sceneId = open.sceneId
        if (!sceneId) {
          const o = await outlineOf(open.storyId)
          const remembered = lastSceneOf(open.storyId)
          sceneId = o.scenes.find((s) => s.id === remembered)?.id ?? o.scenes[0]?.id ?? null
        }
        await editorBridge()?.flush()
        if (sceneId) requestEditorFocus(sceneId)
        a.selectScene(sceneId, open.storyId)
        return
      }
      case 'style':
        a.navigate(open.storyId ? { kind: 'story', storyId: open.storyId } : { kind: 'style' })
        return
    }
  } catch (e) {
    failed(e)
  }
}
