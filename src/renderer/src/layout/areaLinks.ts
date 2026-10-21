// The links each area (each room, on the desk) offers, as data: what they say, their icon, when they are the page
// showing, when they can't be used, and what they do. The panels' side list (layout/AreaList.tsx) draws them as rows
// beside the rail; the desk's room frame (layout/desk/RoomFrame.tsx) as a quiet row of links under the room's name.
import type { Chapter, EntryKind, ID } from '@shared/types'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import {
  CalendarRange,
  CircleAlert,
  CookingPot,
  Feather,
  History,
  LayoutGrid,
  Lightbulb,
  ListTree,
  MessageCircleQuestion,
  Network,
  NotebookText,
  Palette,
  SearchCheck,
  Settings2,
  Spool,
  StickyNote,
  WandSparkles,
  type IconType
} from '@/components/ui/icons'
import { useApp, type InspectorTab, type View } from '@/lib/store'
import { openConsistency } from '@/features/consistency/checkStore'
import { openChapterPlan, openPlanHub, openSceneTool } from '@/features/outline/open'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { openRecipes } from '@/features/recipes/recipeStore'
import { openStorySettings } from '@/features/stories/storyActions'
import { CODEX_KINDS } from '@/features/codex/codexLogic'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { openWorldBuilder } from '@/features/worldBuilder/open'

export interface AreaLink {
  id: string
  label: string
  /** Said on hover. */
  hint?: string
  icon: IconType
  /** A kind of thing in the world: its icon sits on a tile in its ink. */
  kind?: EntryKind
  /** A count beside it (null while it loads). */
  count?: number | null
  /** It is the page showing. */
  active: boolean
  disabled?: boolean
  run(): void
}

/** Where Adam is, for the links. */
export interface LinkContext {
  view: View
  storyId: ID | null
  sceneId: ID | null
  /** Each kind's number of entries (null while loading). */
  counts: Partial<Record<EntryKind, number>> | null
  /** The open story's chapters. */
  chapters: Chapter[]
  /** The scene panel (the desk's drawer) shows the Issues tab on the writing page. */
  issuesShowing: boolean
}

const is = (view: View, kind: View['kind']): boolean => view.kind === kind
const go = (view: View): void => useApp.getState().navigate(view)

/** Opens a tab of the scene panel beside the page (the desk's drawer), on the writing page. */
export function openSceneTab(tab: InspectorTab): void {
  const app = useApp.getState()
  app.setInspectorTab(tab)
  app.peekEntry(null)
  if (app.askOpen) app.setAskOpen(false)
  if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
  app.navigate({ kind: 'write' })
}

/** Write: the page (on the desk, where the binder is the spine's), the style guide and the story's settings. */
export function writeLinks(c: LinkContext): AreaLink[] {
  return [
    { id: 'page', label: 'Page', hint: 'The scene you are writing', icon: Feather, active: is(c.view, 'write'), run: () => go({ kind: 'write' }) },
    { id: 'style', label: 'Style guide', icon: Palette, active: is(c.view, 'style'), run: () => go({ kind: 'style' }) },
    {
      id: 'story',
      label: 'Story settings',
      icon: Settings2,
      disabled: !c.storyId,
      active: is(c.view, 'story'),
      run: () => c.storyId && openStorySettings(c.storyId)
    }
  ]
}

/** Whether the open scene has words (the outline in the binder says). */
const sceneWritten = (sceneId: ID | null): boolean => (useOutlineStore.getState().outline?.scenes.find((s) => s.id === sceneId)?.wordCount ?? 0) > 0

/**
 * Plan: Build with AI first (2026-10-20: every AI building tool for the story in one area; the Plan hub, the Story
 * builder and a chapter's plan before), next scene ideas and Interview me (the open scene, while it is planned, in Build
 * with AI's story line with its ideas or interview open; else the story line at "the next scene"), the plot threads and
 * story recipes.
 */
export function planLinks(c: LinkContext): AreaLink[] {
  const storyId = c.storyId
  const building = c.view.kind === 'planHub' || c.view.kind === 'outline' || c.view.kind === 'storyBuilder' || c.view.kind === 'recipePlan'
  return [
    {
      id: 'planHub',
      label: 'Build with AI',
      hint: 'Every part of your story built with AI, in one place: your idea, the cast and world, the story line, the threads',
      icon: ListTree,
      disabled: !storyId,
      active: building,
      run: () => storyId && openPlanHub(storyId)
    },
    {
      id: 'ideas',
      label: 'Next scene ideas',
      hint: 'Three directions for a planned scene, in Build with AI’s story line',
      icon: Lightbulb,
      disabled: !storyId,
      active: false,
      run: () => storyId && openSceneTool(storyId, c.sceneId, 'ideas', sceneWritten(c.sceneId))
    },
    {
      id: 'interview',
      label: 'Interview me',
      hint: 'A few questions about a planned scene, and its card filled in from your answers, in Build with AI’s story line',
      icon: MessageCircleQuestion,
      disabled: !storyId,
      active: false,
      run: () => storyId && openSceneTool(storyId, c.sceneId, 'interview', sceneWritten(c.sceneId))
    },
    { id: 'threads', label: 'Plot threads board', icon: Spool, active: is(c.view, 'threads'), run: () => go({ kind: 'threads' }) },
    { id: 'recipes', label: 'Story recipes', icon: CookingPot, active: is(c.view, 'recipes'), run: openRecipes }
  ]
}

/** The desk's story board (the Plan room's front page; the panels' side list doesn't offer it). */
export function boardLink(c: LinkContext): AreaLink {
  const storyId = c.storyId
  return {
    id: 'board',
    label: 'Story board',
    hint: 'Every scene as an index card, a column for each chapter, with the plot threads as strings',
    icon: StickyNote,
    disabled: !storyId,
    active: is(c.view, 'board'),
    run: () => storyId && go({ kind: 'board', storyId })
  }
}

/** Plan a chapter: one link for each of the open story's chapters (Plan this chapter, open in its row of Build with AI). */
export function chapterLinks(c: LinkContext): AreaLink[] {
  const storyId = c.storyId
  if (!storyId) return []
  return c.chapters.map((ch, i) => ({
    id: ch.id,
    label: ch.title.trim() || `Chapter ${i + 1}`,
    icon: NotebookText,
    active: false,
    run: () => openChapterPlan(storyId, ch.id)
  }))
}

/** World: everything in the world, then each kind with its count. */
export function worldLinks(c: LinkContext): AreaLink[] {
  return [
    {
      id: 'codex',
      label: 'Everything',
      hint: 'The codex: every character, place and more, as cards',
      icon: LayoutGrid,
      // What the codex shows: plot threads live on their own board, so they aren't counted here (Plot threads has them).
      count: c.counts ? CODEX_KINDS.reduce((n, k) => n + (c.counts?.[k] ?? 0), 0) : null,
      active: is(c.view, 'codex'),
      run: () => go({ kind: 'codex' })
    },
    ...ENTRY_KINDS.map(
      (kind): AreaLink => ({
        id: `kind:${kind}`,
        kind,
        icon: KIND_ICONS[kind],
        label: KIND_LABELS[kind].many,
        count: c.counts ? (c.counts[kind] ?? 0) : null,
        active: (c.view.kind === 'entries' || c.view.kind === 'builder') && c.view.entryKind === kind,
        run: () => go({ kind: 'entries', entryKind: kind, entryId: null })
      })
    )
  ]
}

/** The world seen whole: the relationship map, the timeline, and building from a summary. */
export function worldViewLinks(c: LinkContext): AreaLink[] {
  return [
    { id: 'map', label: 'Relationship map', icon: Network, active: is(c.view, 'map'), run: () => go({ kind: 'map' }) },
    { id: 'timeline', label: 'Timeline', icon: CalendarRange, active: is(c.view, 'timeline'), run: () => go({ kind: 'timeline' }) },
    { id: 'worldBuilder', label: 'Build from a summary', icon: WandSparkles, active: is(c.view, 'worldBuilder'), run: () => openWorldBuilder() }
  ]
}

/** Check: the story's consistency, what the memory changed, and the open scene's issues (in the scene panel). */
export function checkLinks(c: LinkContext): AreaLink[] {
  return [
    {
      id: 'consistency',
      label: 'Consistency',
      hint: 'The story’s issues by chapter and scene, and checking a chapter or the whole story',
      icon: SearchCheck,
      disabled: !c.storyId,
      active: is(c.view, 'consistency'),
      run: () => c.storyId && openConsistency(c.storyId)
    },
    {
      id: 'memory',
      label: 'What changed',
      hint: 'What the memory keeper changed, with Undo',
      icon: History,
      active: is(c.view, 'memory'),
      run: () => go({ kind: 'memory', sceneId: null })
    },
    {
      id: 'sceneIssues',
      label: 'This scene’s issues',
      icon: CircleAlert,
      disabled: !c.sceneId,
      active: c.issuesShowing,
      run: () => openSceneTab('issues')
    }
  ]
}
