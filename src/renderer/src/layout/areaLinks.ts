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
  WandSparkles,
  type IconType
} from '@/components/ui/icons'
import { useApp, type View } from '@/lib/store'
import { openConsistency } from '@/features/consistency/checkStore'
import { openOutlineHelper } from '@/features/outline/open'
import { openRecipes } from '@/features/recipes/recipeStore'
import { openStorySettings } from '@/features/stories/storyActions'
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

/** Opens the open scene's card in the scene panel beside the page (its ideas for what happens next and Interview me). */
export function openSceneCard(): void {
  openSceneTab('card')
}

/** Opens a tab of the scene panel beside the page (the desk's drawer), on the writing page. */
export function openSceneTab(tab: 'card' | 'issues'): void {
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

/** Plan: the outline helper, the scene card's ideas and interview, the plot threads and story recipes. */
export function planLinks(c: LinkContext): AreaLink[] {
  const planning = c.view.kind === 'outline' ? c.view : null
  return [
    {
      id: 'outline',
      label: 'Outline helper',
      hint: 'Acts, chapters and scene cards suggested from your premise',
      icon: ListTree,
      disabled: !c.storyId,
      active: !!planning && !planning.chapterId,
      run: () => c.storyId && openOutlineHelper(c.storyId)
    },
    {
      id: 'ideas',
      label: 'Next scene ideas',
      hint: 'On an empty scene’s card: three directions for what happens next',
      icon: Lightbulb,
      disabled: !c.sceneId,
      active: false,
      run: openSceneCard
    },
    {
      id: 'interview',
      label: 'Interview me',
      hint: 'On the scene’s card: a few questions, and the card filled in from your answers',
      icon: MessageCircleQuestion,
      disabled: !c.sceneId,
      active: false,
      run: openSceneCard
    },
    { id: 'threads', label: 'Plot threads board', icon: Spool, active: is(c.view, 'threads'), run: () => go({ kind: 'threads' }) },
    { id: 'recipes', label: 'Story recipes', icon: CookingPot, active: is(c.view, 'recipes') || is(c.view, 'recipePlan'), run: openRecipes }
  ]
}

/** Plan a chapter: one link for each of the open story's chapters (its plan from its interview). */
export function chapterLinks(c: LinkContext): AreaLink[] {
  const planning = c.view.kind === 'outline' ? c.view : null
  const storyId = c.storyId
  if (!storyId) return []
  return c.chapters.map((ch, i) => ({
    id: ch.id,
    label: ch.title.trim() || `Chapter ${i + 1}`,
    icon: NotebookText,
    active: planning?.chapterId === ch.id,
    run: () => go({ kind: 'outline', storyId, chapterId: ch.id })
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
      count: c.counts ? Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0) : null,
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
