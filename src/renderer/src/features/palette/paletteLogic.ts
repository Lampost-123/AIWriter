// The command palette's logic (milestone 3): every action it can run, which of them fit the moment,
// finding them by typing, and the list it shows (actions, then search results, each group with
// "Show more"). Pure, so it is unit-tested; CommandPalette.tsx shows it and actions.ts runs it.

import type { EntryKind, ThemeName } from '@shared/types'
import type { SearchHit, SearchPlace, SearchResults } from '@shared/contracts/search'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import type { ShortcutId } from '@/lib/shortcuts'

// ---------- Words ----------

const MARKS = /\p{M}/gu
const SPLIT = /[^\p{L}\p{N}]+/u

/** Lower case without accents, as the search in the main process folds text (src/main/search/text.ts). */
export const fold = (s: string): string => s.normalize('NFKD').replace(MARKS, '').toLowerCase()

/** The words of some text, folded. */
export const wordsOf = (s: string): string[] => fold(s).split(SPLIT).filter(Boolean)

/** True when the query has something to search for (not only spaces and marks). */
export const hasWords = (query: string): boolean => wordsOf(query).length > 0

// ---------- Actions ----------

/** Actions with one fixed meaning. Opening each kind's list and making a new entry of each kind are added per kind. */
export type FixedActionId =
  | 'new-scene'
  | 'new-chapter'
  | 'new-story'
  | 'generate'
  | 'stop'
  | 'mark-done'
  | 'reopen-scene'
  | 'delete-scene'
  | 'go-write'
  | 'go-codex'
  | 'go-timeline'
  | 'go-map'
  | 'go-threads'
  | 'go-style'
  | 'go-memory'
  | 'go-story'
  | 'quick-character'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-sepia'
  | 'theme-system'
  | 'toggle-binder'
  | 'toggle-panel'
  | 'tab-card'
  | 'tab-context'
  | 'tab-cast'
  | 'tab-issues'
  | 'tab-drafts'
  | 'settings-models'
  | 'settings-preferences'
  | 'settings-appearance'
  | 'settings-backups'
  | 'settings-trash'
  | 'settings-about'
  | 'backup-now'
  | 'new-world'
  | 'switch-world'
  | 'rename-world'
  | 'shortcuts'
  // Milestone 4
  | 'variants'
  | 'beat-by-beat'
  | 'history'
  | 'continue'
  | 'ask-world'
  | 'outline-helper'
  | 'scene-ideas'
  | 'scene-interview'
  | 'chapter-interview'
  | 'listen'
  | 'stop-reading'
  | 'show-speakers'
  | 'hide-speakers'
  | 'settings-speech'
  | 'world-builder'
  // Milestone 5
  | 'check-scene'
  | 'check-chapter'
  | 'check-story'
  | 'go-consistency'
  // Milestone 6
  | 'export-story'
  | 'export-bible'
  | 'export-world'
  | 'copy-world'
  | 'import-world'
  | 'settings-usage'
  | 'import-manuscript'
  | 'build-memory'
  | 'focus-mode'
  | 'leave-focus-mode'
  | 'sample-world'
  // The start screen
  | 'start-screen'
  | 'go-recipes'
  | 'make-recipe'
  // Writing by hand
  | 'bold'
  | 'italic'
  | 'block-quote'
  | 'scene-break'
  | 'paste-plain'
  | 'find-scene'
  | 'find-story'
  | 'settings-editor'
  | 'spell-check-on'
  | 'spell-check-off'
  | 'word-counts'
  // Sound effects under Read aloud
  | 'sounds'

export type ActionId = FixedActionId | `go-${EntryKind}` | `new-${EntryKind}`

/** Where Adam is, which decides the actions that make sense now. */
export interface ActionContext {
  /** The page showing ('write', 'codex', 'settings'...). */
  view: string
  storyId: string | null
  sceneId: string | null
  /** The open scene is marked done. */
  sceneDone: boolean
  /** A draft is being written. */
  drafting: boolean
  theme: ThemeName
  /** Read aloud is turned on in Settings (milestone 4). */
  readAloud?: boolean
  /** Something is being read aloud now. */
  reading?: boolean
  /** "Show speakers and tone" is on. */
  speakers?: boolean
  /** Milestone 6: the open story has scenes the memory hasn't read since they were imported. */
  unreadStory?: boolean
  /** Focus mode is on (milestone 6). */
  focus?: boolean
  /** Writing by hand: spell check is on (Settings › Editor). */
  spellCheck?: boolean
  /** Sound effects are on (with read aloud): the scene panel has its Sounds tab. */
  soundEffects?: boolean
}

export interface ActionDef {
  id: ActionId
  /** What it does, in plain words (also its accessible name). */
  label: string
  /** Another name it goes by elsewhere in the app, found as its own name is. */
  also?: string
  /** Other words it is found by. */
  keywords: string
  shortcut?: ShortcutId
  /** It goes to another page (always, or from where Adam is now), so keyboard focus isn't put back where it was. */
  away?: boolean | ((c: ActionContext) => boolean)
  /** Shown only when it can be done now. */
  when?: (c: ActionContext) => boolean
}

/** True when running the action now takes Adam to another page. */
export const goesAway = (a: ActionDef, c: ActionContext): boolean => (typeof a.away === 'function' ? a.away(c) : !!a.away)

const hasStory = (c: ActionContext): boolean => !!c.storyId
const hasScene = (c: ActionContext): boolean => !!c.sceneId
/** The scene is on screen (not only open behind another page). */
const seesScene = (c: ActionContext): boolean => hasScene(c) && c.view === 'write'
const notTheme = (t: ThemeName) => (c: ActionContext) => c.theme !== t
/** Done on the writing page: from another page, it goes back there (with the caret in the page). */
const toWriting = (c: ActionContext): boolean => c.view !== 'write'

/** "New character", "New plot thread", "New term". */
const newLabel = (kind: EntryKind): string => `New ${KIND_LABELS[kind].one.toLowerCase()}`

export const ACTIONS: ActionDef[] = [
  // First, so from another page "write" finds the way back before Generate (which would start a draft).
  { id: 'go-write', label: 'Back to writing', keywords: 'write page scene editor manuscript', away: true, when: (c) => c.view !== 'write' },
  {
    id: 'generate',
    label: 'Generate a draft',
    keywords: 'write ai scene draft',
    shortcut: 'generate',
    away: toWriting,
    when: (c) => hasScene(c) && !c.drafting
  },
  { id: 'stop', label: 'Stop the draft', keywords: 'cancel halt writing', shortcut: 'stop', when: (c) => c.drafting },
  // From another page these two go back to the scene first, as Generate does, so Adam sees which scene it was.
  {
    id: 'mark-done',
    label: 'Mark scene done',
    keywords: 'finish finished complete accept',
    shortcut: 'markDone',
    away: toWriting,
    when: (c) => hasScene(c) && !c.sceneDone
  },
  {
    id: 'reopen-scene',
    label: 'Reopen this scene',
    keywords: 'done undo mark more work revise',
    away: toWriting,
    when: (c) => hasScene(c) && c.sceneDone
  },
  { id: 'new-scene', label: 'New scene', keywords: 'add write', away: toWriting, when: hasStory },
  { id: 'new-chapter', label: 'New chapter', keywords: 'add', away: toWriting, when: hasStory },
  { id: 'new-story', label: 'New story', keywords: 'add book sequel prequel side novella series' },
  // Only with the scene on screen: never a scene Adam isn't looking at.
  { id: 'delete-scene', label: 'Delete this scene', keywords: 'remove trash bin', when: seesScene },
  { id: 'go-codex', label: 'Codex', keywords: 'entries cards world bible memory everything', away: true },
  ...ENTRY_KINDS.map((kind): ActionDef => ({ id: `go-${kind}`, label: KIND_LABELS[kind].many, keywords: 'list', away: true })),
  { id: 'go-timeline', label: 'Timeline', keywords: 'when dates order events calendar', away: true },
  { id: 'go-map', label: 'Relationship map', keywords: 'relationships characters web family', away: true },
  { id: 'go-threads', label: 'Plot threads board', keywords: 'threads setups payoffs promises', away: true },
  { id: 'go-style', label: 'Style guide', keywords: 'voice prose point view tense spelling', away: true },
  // The top bar's "Memory updated" note opens it.
  { id: 'go-memory', label: 'What changed', also: 'Memory updated', keywords: 'history log', away: true },
  { id: 'go-story', label: 'Story settings', keywords: 'this story premise start kind time gap', away: true, when: hasStory },
  ...ENTRY_KINDS.map((kind): ActionDef => ({ id: `new-${kind}`, label: newLabel(kind), keywords: 'add create make', away: true })),
  { id: 'quick-character', label: 'Quick start a character', keywords: 'builder ai make create new character', away: true },
  { id: 'theme-light', label: 'Light theme', keywords: 'appearance colours colors mode', when: notTheme('light') },
  { id: 'theme-dark', label: 'Dark theme', keywords: 'appearance colours colors mode night', when: notTheme('dark') },
  { id: 'theme-sepia', label: 'Sepia theme', keywords: 'appearance colours colors mode paper', when: notTheme('sepia') },
  {
    id: 'theme-system',
    label: 'Match the system theme',
    keywords: 'appearance colours colors mode automatic light dark',
    when: notTheme('system')
  },
  { id: 'toggle-binder', label: 'Show or hide the binder', keywords: 'panel left side chapters scenes' },
  {
    id: 'toggle-panel',
    label: 'Show or hide the scene panel',
    keywords: 'panel right side card context drafts',
    when: (c) => hasScene(c) && c.view === 'write'
  },
  // The scene panel's tabs (on the desk, its drawer), each opened straight from here.
  { id: 'tab-card', label: 'Scene card', also: 'Scene details', keywords: 'scene panel drawer goal summary point of view when beats', away: toWriting, when: hasScene },
  { id: 'tab-context', label: 'Scene context', also: 'Scene panel › Context', keywords: 'briefing what the ai sees knows details drawer', away: toWriting, when: hasScene },
  { id: 'tab-cast', label: 'Scene cast', also: 'Scene panel › Cast', keywords: 'characters people who is in it details drawer', away: toWriting, when: hasScene },
  { id: 'tab-issues', label: 'Scene issues', also: 'Scene panel › Issues', keywords: 'problems mistakes consistency found details drawer', away: toWriting, when: hasScene },
  { id: 'tab-drafts', label: 'Scene drafts', also: 'Scene panel › Drafts', keywords: 'ai versions written generated details drawer', away: toWriting, when: hasScene },
  {
    id: 'settings-models',
    label: 'Settings › Models',
    keywords: 'provider openrouter key writer memory model',
    shortcut: 'settings',
    away: true
  },
  {
    id: 'settings-preferences',
    label: 'Settings › My writing preferences',
    keywords: 'spelling point view tense voice words',
    away: true
  },
  { id: 'settings-appearance', label: 'Settings › Appearance', keywords: 'theme accent colour color text size page width', away: true },
  { id: 'settings-backups', label: 'Settings › Backups', keywords: 'restore copy folder', away: true },
  { id: 'settings-trash', label: 'Settings › Recently deleted', keywords: 'trash bin restore bring back', away: true },
  { id: 'settings-about', label: 'Settings › About and updates', keywords: 'version update help', away: true },
  // Milestone 6
  {
    id: 'settings-usage',
    label: 'Usage and cost',
    also: 'Settings › Usage and cost',
    keywords: 'spending money dollars price tokens limit monthly budget bill ai',
    away: true
  },
  { id: 'backup-now', label: 'Back up now', keywords: 'backup copy save' },
  { id: 'new-world', label: 'New world', keywords: 'add create' },
  { id: 'switch-world', label: 'Switch to another world', keywords: 'open change worlds' },
  { id: 'rename-world', label: 'Rename this world', keywords: 'name title' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: 'keys help hotkeys', shortcut: 'shortcuts' },
  // ----- Milestone 4 -----
  {
    id: 'variants',
    label: 'Variants side by side',
    keywords: 'ai drafts versions compare pick choose',
    away: true,
    when: (c) => hasScene(c) && !c.drafting
  },
  {
    id: 'beat-by-beat',
    label: 'Beat by beat',
    keywords: 'ai draft steer step pause',
    away: toWriting,
    when: (c) => hasScene(c) && !c.drafting
  },
  { id: 'history', label: 'Scene history', keywords: 'snapshots earlier versions compare restore drafts', away: true, when: hasScene },
  {
    id: 'continue',
    label: 'Continue from the cursor',
    keywords: 'ai write on more carry',
    away: toWriting,
    when: (c) => hasScene(c) && !c.drafting
  },
  { id: 'ask-world', label: 'Ask the world', keywords: 'chat brainstorm question ai ideas memory', away: toWriting },
  { id: 'outline-helper', label: 'Outline helper', keywords: 'ai plan premise acts chapters scenes suggest', away: true, when: hasStory },
  { id: 'scene-ideas', label: 'Ideas for this scene', keywords: 'ai next scene directions suggest card', away: toWriting, when: hasScene },
  { id: 'scene-interview', label: 'Interview me about this scene', keywords: 'ai questions plan card fill', away: toWriting, when: hasScene },
  { id: 'chapter-interview', label: 'Interview me about this chapter', keywords: 'ai questions plan goal scenes suggest', away: true, when: hasScene },
  {
    id: 'listen',
    label: 'Listen',
    keywords: 'read aloud speak voice hear audio pause',
    shortcut: 'listen',
    away: toWriting,
    when: (c) => hasScene(c) && !!c.readAloud
  },
  {
    id: 'stop-reading',
    label: 'Stop reading aloud',
    keywords: 'listen speak voice halt',
    shortcut: 'stopReading',
    when: (c) => !!c.reading
  },
  {
    id: 'show-speakers',
    label: 'Show speakers and tone',
    keywords: 'who says speaking voice emotion tone mood dialogue labels read aloud',
    when: (c) => !c.speakers
  },
  {
    id: 'hide-speakers',
    label: 'Hide speakers and tone',
    keywords: 'who says speaking voice emotion tone mood dialogue labels read aloud',
    when: (c) => !!c.speakers
  },
  {
    id: 'sounds',
    label: 'Sounds in this scene',
    keywords: 'sound effects ambience audio noises background read aloud listen add remove find',
    away: toWriting,
    when: (c) => hasScene(c) && !!c.soundEffects
  },
  {
    id: 'settings-speech',
    label: 'Settings › Read aloud and dictation',
    keywords: 'voice speech speak listen microphone dictate talk narrator',
    away: true
  },
  {
    id: 'world-builder',
    label: 'Build the world from a summary',
    keywords: 'builder ai quick start lay out fill make characters places lore rules premise paste',
    away: true
  },
  // ----- Milestone 5 -----
  // Checking runs in the background (a quiet line in the binder), so these stay where Adam is.
  { id: 'check-scene', label: 'Check this scene', keywords: 'consistency issues mistakes contradictions facts ai', when: hasScene },
  { id: 'check-chapter', label: 'Check this chapter', keywords: 'consistency issues mistakes contradictions facts ai', when: hasScene },
  { id: 'check-story', label: 'Check this story', keywords: 'consistency issues mistakes contradictions facts ai whole book', when: hasStory },
  {
    id: 'go-consistency',
    label: 'Open consistency',
    also: 'Consistency',
    keywords: 'issues problems mistakes contradictions repetition repeated words pet phrases plot threads report',
    away: true,
    when: hasStory
  },
  // ----- Milestone 6 -----
  { id: 'export-story', label: 'Export story', keywords: 'word docx epub ebook pdf markdown text manuscript chapter save print', when: hasStory },
  { id: 'export-bible', label: 'Export series bible', keywords: 'entries characters places lore timeline plot threads pdf markdown bible save print', when: hasStory },
  { id: 'export-world', label: 'Export world', keywords: 'aiwrite file move computer save share whole' },
  { id: 'copy-world', label: 'Make a copy of this world', keywords: 'duplicate world copy' },
  { id: 'import-world', label: 'Import a world file', keywords: 'aiwrite open file move computer bring in' },
  {
    id: 'import-manuscript',
    label: 'Import a manuscript',
    keywords: 'word docx markdown text txt file book novel bring open existing chapters scenes',
    away: true
  },
  {
    id: 'build-memory',
    label: 'Build the memory from this story',
    keywords: 'imported read catch up learn characters ai',
    away: true,
    when: (c) => !!c.unreadStory
  },
  {
    id: 'focus-mode',
    label: 'Focus mode',
    keywords: 'distraction free full screen fullscreen zen hide panels page only',
    shortcut: 'focusMode',
    away: toWriting,
    when: (c) => hasScene(c) && !c.focus
  },
  {
    id: 'leave-focus-mode',
    label: 'Leave focus mode',
    keywords: 'exit distraction free full screen fullscreen show panels',
    shortcut: 'leaveFocusMode',
    when: (c) => !!c.focus
  },
  { id: 'sample-world', label: 'Explore the sample world', keywords: 'example demo tour try look round gullhaven', away: true },
  // The start screen: every world and story, where Adam left off, and starting something new.
  { id: 'start-screen', label: 'Go to the start screen', also: 'Home', keywords: 'home welcome all worlds stories library list continue left off recently deleted', away: true },
  // Story recipes
  { id: 'go-recipes', label: 'Story recipes', keywords: 'recipe library structure style shape beats template', away: true },
  { id: 'make-recipe', label: 'Make a recipe from a story', keywords: 'recipe import story book style structure distil', away: true },
  // Writing by hand
  { id: 'bold', label: 'Bold', keywords: 'format strong heavy text style', shortcut: 'bold', when: seesScene },
  { id: 'italic', label: 'Italic', keywords: 'format emphasis slanted text style', shortcut: 'italic', when: seesScene },
  { id: 'block-quote', label: 'Block quote', keywords: 'format quotation indent letter inset', shortcut: 'quote', when: seesScene },
  { id: 'scene-break', label: 'Scene break', keywords: 'format divider separator rule section line', when: seesScene },
  { id: 'paste-plain', label: 'Paste as plain text', keywords: 'format clipboard unformatted without formatting', shortcut: 'pastePlain', when: seesScene },
  {
    id: 'find-scene',
    label: 'Find and replace in this scene',
    keywords: 'search change words swap',
    shortcut: 'findInScene',
    away: toWriting,
    when: hasScene
  },
  { id: 'find-story', label: 'Find and replace in the whole story', keywords: 'search change words swap rename everywhere all scenes', shortcut: 'findInStory', when: hasStory },
  {
    id: 'settings-editor',
    label: 'Settings › Editor',
    keywords: 'spelling spell check dictionary smart quotes punctuation typewriter scrolling daily word target goal streak',
    away: true
  },
  { id: 'spell-check-on', label: 'Turn spell check on', keywords: 'spelling underline misspelt dictionary', when: (c) => c.spellCheck === false },
  { id: 'spell-check-off', label: 'Turn spell check off', keywords: 'spelling underline misspelt dictionary', when: (c) => c.spellCheck !== false },
  {
    id: 'word-counts',
    label: 'Word counts and today’s writing',
    keywords: 'words count length pages reading time chapter story selection daily target goal streak today',
    away: toWriting,
    when: hasScene
  }
]

/** For opening each kind's list and making a new entry: which, and of what kind. Null for the other actions. */
export function entryAction(id: ActionId): { verb: 'go' | 'new'; kind: EntryKind } | null {
  const [verb, ...rest] = id.split('-')
  const kind = rest.join('-') as EntryKind
  return (verb === 'go' || verb === 'new') && ENTRY_KINDS.includes(kind) ? { verb, kind } : null
}

export const availableActions = (c: ActionContext): ActionDef[] => ACTIONS.filter((a) => !a.when || a.when(c))

/**
 * The actions that match what Adam typed: every word must start a word of the action's names or
 * its other words. Names that start with the query come first, then names holding every word, then
 * matches through the other words; otherwise in the list's own order.
 */
export function matchActions(query: string, c: ActionContext): ActionDef[] {
  const words = wordsOf(query)
  if (!words.length) return []
  const whole = words.join(' ')
  const found: { a: ActionDef; rank: number; i: number }[] = []
  availableActions(c).forEach((a, i) => {
    const names = [a.label, ...(a.also ? [a.also] : [])].map(wordsOf)
    const name = names.flat()
    const extra = wordsOf(a.keywords)
    const starts = (list: string[], w: string): boolean => list.some((x) => x.startsWith(w))
    if (!words.every((w) => starts(name, w) || starts(extra, w))) return
    const rank = names.some((n) => n.join(' ').startsWith(whole)) ? 0 : words.every((w) => starts(name, w)) ? 1 : 2
    found.push({ a, rank, i })
  })
  return found.sort((x, y) => x.rank - y.rank || x.i - y.i).map((f) => f.a)
}

/** With nothing typed: the most useful actions for the moment. */
const SUGGESTED: ActionId[] = [
  'generate',
  'stop',
  'mark-done',
  'new-scene',
  'go-codex',
  'new-character',
  'quick-character',
  'go-memory',
  'shortcuts'
]

export function suggestedActions(c: ActionContext, max = 6): ActionDef[] {
  const ok = new Set(availableActions(c).map((a) => a.id))
  return SUGGESTED.filter((id) => ok.has(id))
    .slice(0, max)
    .map((id) => ACTIONS.find((a) => a.id === id)!)
}

// ---------- The list ----------

/** How many actions show while typing, before "Show more actions". */
export const ACTION_LIMIT = 5

export type Row =
  | { type: 'heading'; key: string; label: string }
  | { type: 'action'; key: string; action: ActionDef }
  | { type: 'hit'; key: string; hit: SearchHit }
  | { type: 'more'; key: string; group: string; label: string; total: number }
  | { type: 'note'; key: string; text: string }
  /** The desk's command bar: ask the world what was typed (Ask the world opens with it in its box). */
  | { type: 'ask'; key: string; query: string }

export type Option = Extract<Row, { type: 'action' | 'hit' | 'more' | 'ask' }>

export const isOption = (r: Row): r is Option => r.type === 'action' || r.type === 'hit' || r.type === 'more' || r.type === 'ask'

/**
 * The row a move of `by` lands on in a list of `n` options, from `index` (-1: none yet). Single steps
 * wrap around the ends; page steps stop at them.
 */
export function stepIndex(index: number, by: number, n: number): number {
  if (!n) return -1
  if (Math.abs(by) === 1) return index < 0 ? (by > 0 ? 0 : n - 1) : (index + by + n) % n
  return Math.max(0, Math.min(n - 1, index + by))
}

export interface ListInput {
  query: string
  /** Actions matching the query (matchActions). */
  actions: ActionDef[]
  /** Search results for the query; null while there are none (nothing typed, or not back yet). */
  results: SearchResults | null
  /** With nothing typed: recent places and suggested actions. */
  recent: SearchHit[]
  suggested: ActionDef[]
  /** Groups Adam asked to see more of ('actions' or a search group's id). */
  expanded: ReadonlySet<string>
  /** The desk: what is typed can be asked of the world too ("Ask the world: …", after the actions). */
  ask?: boolean
}

/**
 * Everything the palette lists, in order. With nothing typed: recent places, then suggested
 * actions. While typing: matching actions first, then each group of search results (entries'
 * groups come first from the search), each with "Show more" when it has more.
 */
export function paletteRows(input: ListInput): Row[] {
  const rows: Row[] = []
  if (!hasWords(input.query)) {
    if (input.recent.length) {
      rows.push({ type: 'heading', key: 'h:recent', label: 'Recent' })
      for (const hit of input.recent) rows.push({ type: 'hit', key: `recent:${hit.key}`, hit })
    }
    if (input.suggested.length) {
      rows.push({ type: 'heading', key: 'h:suggested', label: 'Suggested' })
      for (const action of input.suggested) rows.push({ type: 'action', key: `action:${action.id}`, action })
    }
    return rows
  }

  if (input.actions.length) {
    const all = input.expanded.has('actions')
    rows.push({ type: 'heading', key: 'h:actions', label: 'Actions' })
    const shown = all ? input.actions : input.actions.slice(0, ACTION_LIMIT)
    for (const action of shown) rows.push({ type: 'action', key: `action:${action.id}`, action })
    if (!all && input.actions.length > ACTION_LIMIT) {
      rows.push({ type: 'more', key: 'more:actions', group: 'actions', label: 'Show more actions', total: input.actions.length })
    }
  }
  if (input.ask) {
    rows.push({ type: 'heading', key: 'h:ask', label: 'Ask the world' })
    rows.push({ type: 'ask', key: 'ask', query: input.query.trim() })
  }
  for (const g of input.results?.groups ?? []) {
    rows.push({ type: 'heading', key: `h:${g.id}`, label: g.label })
    for (const hit of g.hits) rows.push({ type: 'hit', key: `${g.id}:${hit.key}`, hit })
    if (g.total > g.hits.length) {
      if (input.expanded.has(g.id)) {
        const text = `Showing ${g.hits.length} of ${g.total.toLocaleString('en-GB')}. Add a word to narrow it down.`
        rows.push({ type: 'note', key: `note:${g.id}`, text })
      } else rows.push({ type: 'more', key: `more:${g.id}`, group: g.id, label: `Show more ${g.label.toLowerCase()}`, total: g.total })
    }
  }
  return rows
}

// ---------- Recent places ----------

/** Recent places, newest first: this one moves to the front, each place once, at most `max`. */
export function remember(list: SearchPlace[], place: SearchPlace, max = 8): SearchPlace[] {
  return [place, ...list.filter((p) => !(p.kind === place.kind && p.id === place.id))].slice(0, max)
}
