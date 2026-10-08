// The editor chat's tools (Adam, 2026-10-03): what Ask the world's model may use on the way to its answer. Looking
// things up (a scene's words, the outline, search, an entry, the style guide, a scene's issues) is answered here at
// once. Changes are only ever proposed: each becomes a Proposal Adam applies, or not, from the chat (the window
// applies it through the usual calls, so it can be undone); nothing here writes to the world, and nothing deletes.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { AskChoice, CardProposal, DraftMode, EntryProposal, ParaAnchor, Proposal } from '@shared/contracts/ask'
import type { AskIntent } from '@shared/askIntent'
import { effectiveStyle } from '@shared/style'
import { ENTRY_KINDS, FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import type { ChatMessage, EntryKind, EntryState, ID, Outline, Pin, ToolCall, ToolSpec, WritingPrefs } from '@shared/types'
import { argSummary, changesSummary, counted, shortReason, toolKind, type ToolActivity, type ToolKind, type ToolStatus } from '@shared/toolActivity'
import type { SearchHit } from '@shared/contracts/search'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as mem from '../db/memory'
import { sceneText } from '../db/memory'
import { searchIndex } from '../search'
import { fold, matchesAll, parseQuery, plainWords, snippet, type Term } from '../search/text'
import { effectivePins, happenedText } from '../ai/context'
import { lineAt } from '../memory/asOf'
import { labeler } from '../memory/line'
import { loadMemoryData, loadShape } from '../memory/scene'
import type { WorldShape } from '../memory/types'
import { askedFrom, askPoint, NOT_YET, type AskPoint } from './context'
import { chatExp } from './exp'
import {
  SCENE_CARD_WITH_NAMES,
  STORY_CHANGE_KINDS,
  STORY_ITEM_PROPERTIES,
  STORY_KIND_LINES,
  storyAnswer,
  storyProposeTools,
  storyReadTools,
  type StoryCtx
} from './storyTools'
import {
  anchorAt,
  findWords,
  locate,
  numbered,
  occurrences,
  pageFinds,
  paraAt,
  parasOfPlain,
  wordAfter,
  wordBefore,
  type Found,
  type Para
} from './anchor'

type DB = Database.Database

/**
 * How many requests one answer may take (each look-up is one more): enough to look around and propose a page of
 * corrections, never a runaway bill.
 */
export const MAX_STEPS = 12
/** The most of one scene's words sent back at once. */
const SCENE_CHARS = 24_000
/** The most of any other answer sent back at once. */
const RESULT_CHARS = 8_000
/** The most of a search, the style guide or a scene's issues sent back at once. */
const SHORT_CHARS = 3_000
/** The most search results listed. */
const SEARCH_HITS = 12

/** How a scene after the open one is labelled (rule C6: it may be read, but nobody in the story knows it yet). */
export const LATER = "later — after the open scene; characters don't know these events yet"
/** How the open scene is marked in the outline and in what read_scene and search show. */
export const OPEN_MARK = '◀ open scene'

const str = { type: 'string' } as const
const optionalScene = {
  type: 'string',
  description: 'Which scene: "Ch 2, Sc 1", or its title. Leave it out for the scene the writer has open.'
} as const

/** The tools offered to the model. */
export const EDITOR_TOOLS: ToolSpec[] = [
  {
    name: 'read_scene',
    description:
      "Read the full text of a scene in this story (the open scene when none is named), with its scene card. Italics are shown as *asterisks*, the way propose_rewrite writes them; copy words for find, start and end with or without them. A scene after the open one is marked later: the characters don't know its events yet.",
    parameters: { type: 'object', properties: { scene: optionalScene } }
  },
  {
    name: 'outline',
    description:
      "List this story's chapters and scenes in order, with each scene's status, length and goal. The open scene is marked, and scenes after it are marked later.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'search',
    description:
      "Search this story's scenes, entries, summaries and notes for words or a name, as of the open scene: earlier stories this one follows on from are searched up to where it leaves them, and this story's scenes after the open one are marked later. Other stories are not searched.",
    parameters: { type: 'object', properties: { query: str }, required: ['query'] }
  },
  {
    name: 'get_entry',
    description:
      'Read a character, place, group, item, lore, event, plot thread or glossary entry in full, by its name, as it stands at the open scene (what has happened to it, its ties, what it knows).',
    parameters: { type: 'object', properties: { name: str }, required: ['name'] }
  },
  {
    name: 'style_guide',
    description: "Read the style guide in effect for this story (point of view, tense, prose style, phrases to avoid, limits).",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'scene_issues',
    description: 'List the open consistency issues found in a scene (the open scene when none is named).',
    parameters: { type: 'object', properties: { scene: optionalScene } }
  },
  {
    name: 'propose_edit',
    description:
      "Propose replacing some words in a scene. `find` must be copied exactly from the scene's current text (read it first), within one paragraph and long enough to occur only once; `replace` is the new words ('' to cut). The writer sees it and decides; nothing changes unless they apply it. One change per call; for several, make several calls at once. Changes must not overlap: all the fixes in one sentence go in one change. To revise a change you already proposed, give its number as `revises`. It keeps the words' formatting, so it can't add or remove italics: for that, use propose_rewrite.",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        find: str,
        replace: str,
        why: { type: 'string', description: 'A short reason, in plain words.' },
        revises: { type: 'string', description: 'The number of an earlier change in this answer that this one takes the place of.' }
      },
      required: ['find', 'replace', 'why']
    }
  },
  {
    name: 'propose_rewrite',
    description:
      "Propose rewriting a passage of a scene that runs over several paragraphs (a beat pushed harder, a stretch tightened, a scene's opening redone). `start` is the passage's first few words and `end` its last few words, each copied exactly from the scene's current text (read it first; `start` must occur once, `end` after it); `replace` is the whole new passage, with a blank line between paragraphs and *asterisks* for italics. Keep the writer's voice and change only what was asked. The writer sees the old and new passage and decides; nothing changes unless they apply it. For a change inside one paragraph, use propose_edit, unless it adds, removes or runs across italics (then use this, with `start` and `end` in that paragraph).",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        start: { type: 'string', description: 'The first few words of the passage, exactly as in the scene.' },
        end: { type: 'string', description: 'The last few words of the passage, exactly as in the scene.' },
        replace: { type: 'string', description: 'The new passage; a blank line between paragraphs.' },
        why: { type: 'string', description: 'A short reason, in plain words.' }
      },
      required: ['start', 'end', 'replace', 'why']
    }
  },
  {
    name: 'propose_scene_card',
    description: "Propose new values for parts of a scene's card (only the parts given change). The writer decides.",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        goal: str,
        conflict: str,
        outcome: str,
        mood: str,
        when: str,
        notes: str,
        beats: { type: 'array', items: str, description: 'The whole list of beats, in order (it replaces the card’s).' },
        why: str
      },
      required: ['why']
    }
  },
  {
    name: 'propose_entry_change',
    description:
      "Propose new values for parts of an existing entry (summary, description, aliases, or its own fields by the keys get_entry shows). Only the parts given change. The writer decides.",
    parameters: {
      type: 'object',
      properties: {
        name: str,
        summary: str,
        description: str,
        aliases: { type: 'array', items: str },
        fields: { type: 'object', additionalProperties: str, description: 'Field key to new value.' },
        why: str
      },
      required: ['name', 'why']
    }
  },
  {
    name: 'propose_new_entry',
    description: 'Propose a new entry in the memory. The writer decides.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: [...ENTRY_KINDS] }, name: str, summary: str, description: str, why: str },
      required: ['kind', 'name', 'why']
    }
  },
  {
    name: 'propose_new_scene',
    description: 'Propose a new scene at the end of a chapter ("Ch 2" or its title), with a goal and beats if you have them. The writer decides.',
    parameters: {
      type: 'object',
      properties: { chapter: str, title: str, goal: str, beats: { type: 'array', items: str }, why: str },
      required: ['chapter', 'title', 'why']
    }
  },
  {
    name: 'propose_new_chapter',
    description: 'Propose a new chapter at the end of this story. The writer decides.',
    parameters: { type: 'object', properties: { title: str, why: str }, required: ['title', 'why'] }
  },
  {
    name: 'propose_rename',
    description: 'Propose a new title for a scene or a chapter (name one of them). The writer decides.',
    parameters: {
      type: 'object',
      properties: { scene: str, chapter: str, to: str, why: str },
      required: ['to', 'why']
    }
  }
]

// ---------- The chat overhaul's tools (each behind its lab switch; off, EDITOR_TOOLS as above) ----------

/** The chat overhaul's switches the tools follow, read once per answer so every request of a turn offers the same tools. */
export interface ToolSwitches {
  anchor: boolean
  toolChoice: boolean
  askUser: boolean
  draft: boolean
  /** ACTFIRST: an edit's question before any words are read is sent back; "write the next bit" is made to draft. */
  actFirst?: boolean
  /** STORYTOOLS (chat Phase 3): list_issues, chapter_card, list_threads and the issue_fix, chapter_card, thread changes. */
  storyTools?: boolean
}

export const toolSwitches = (): ToolSwitches => ({
  anchor: chatExp('ANCHOR'),
  toolChoice: chatExp('TOOLCHOICE'),
  askUser: chatExp('ASKUSER'),
  draft: chatExp('DRAFT'),
  actFirst: chatExp('ACTFIRST'),
  storyTools: chatExp('STORYTOOLS')
})

const num = { type: 'number' } as const
const paragraphParam = {
  type: 'number',
  description: 'The paragraph the words are in: the [n] read_scene shows before it (never copy the [n] into the words).'
} as const
const occurrenceParam = { type: 'number', description: 'When the words occur more than once in that paragraph: which one (1 = the first).' } as const
const rangeParam = {
  type: 'array',
  items: num,
  description: 'Whole paragraphs to replace, by the [n] numbers read_scene shows: [from, to] ([4, 4] for paragraph 4 alone).'
} as const

/** read_scene with ANCHOR: the paragraphs come numbered. */
const READ_SCENE_ANCHORED: ToolSpec = {
  name: 'read_scene',
  description:
    "Read the full text of a scene in this story (the open scene when none is named), with its scene card. Each paragraph starts with its number, [n]: give it as `paragraph` (or in `replace_paragraphs`) when proposing a change; never copy it into the words. Italics are shown as *asterisks*, the way rewrites write them; copy words with or without them. A scene after the open one is marked later: the characters don't know its events yet.",
  parameters: { type: 'object', properties: { scene: optionalScene } }
}

const EDIT_ANCHORED: ToolSpec = {
  name: 'propose_edit',
  description:
    "Propose replacing some words in one paragraph of a scene: `paragraph` is its [n] from read_scene, `find` the words to change as they are there (copy them; quotes, dashes and spacing needn't match exactly), `replace` the new words ('' to cut). When the words occur more than once in the paragraph, give `occurrence`. The writer sees it and decides; nothing changes unless they apply it. One change per call; for several, make several calls at once. Changes must not overlap: all the fixes in one sentence go in one change. To revise a change you already proposed, give its number as `revises`. It keeps the words' formatting, so it can't add or remove italics, and it can't run across paragraphs: for either, use propose_rewrite.",
  parameters: {
    type: 'object',
    properties: {
      scene: optionalScene,
      paragraph: paragraphParam,
      find: str,
      occurrence: occurrenceParam,
      replace: str,
      why: { type: 'string', description: 'A short reason, in plain words.' },
      revises: { type: 'string', description: 'The number of an earlier change in this answer that this one takes the place of.' }
    },
    required: ['find', 'replace', 'why']
  }
}

const REWRITE_ANCHORED: ToolSpec = {
  name: 'propose_rewrite',
  description:
    "Propose rewriting a passage of a scene (a beat pushed harder, a stretch tightened, an opening redone, italics added or taken out). For whole paragraphs, give `replace_paragraphs: [from, to]` by the [n] numbers read_scene shows. For a passage that starts or ends inside a paragraph, give `start` (its first few words, copied from the scene) with `paragraph` (the [n] `start` is in) and `end` (its last few words, after `start`). `replace` is the whole new passage, with a blank line between paragraphs and *asterisks* for italics. Keep the writer's voice and change only what was asked. The writer sees the old and new passage and decides; nothing changes unless they apply it. To revise a change you already proposed, give its number as `revises`.",
  parameters: {
    type: 'object',
    properties: {
      scene: optionalScene,
      replace_paragraphs: rangeParam,
      paragraph: paragraphParam,
      start: { type: 'string', description: 'The first few words of the passage, as in the scene.' },
      end: { type: 'string', description: 'The last few words of the passage, as in the scene.' },
      replace: { type: 'string', description: 'The new passage; a blank line between paragraphs.' },
      why: { type: 'string', description: 'A short reason, in plain words.' },
      revises: { type: 'string', description: 'The number of an earlier change in this answer that this one takes the place of.' }
    },
    required: ['replace', 'why']
  }
}

/** The kinds of change propose_changes takes, and the separate tool each stands for. */
export const CHANGE_KINDS = {
  edit: 'propose_edit',
  rewrite: 'propose_rewrite',
  card: 'propose_scene_card',
  entry: 'propose_entry_change',
  new_entry: 'propose_new_entry',
  new_scene: 'propose_new_scene',
  new_chapter: 'propose_new_chapter',
  rename: 'propose_rename'
} as const
export type ChangeKind = keyof typeof CHANGE_KINDS

/** The item kind that asks the writer a question through propose_changes (TOOLCHOICE with ASKUSER). */
export const ASK_KIND = 'ask'

/**
 * propose_changes (TOOLCHOICE): every kind of change in one tool, so one tool can be asked for. With ASKUSER (`ask`)
 * an item can be a question for the writer instead, as ask_user asks it, so a request made to propose can still ask
 * when the request could mean clearly different things. An ask goes alone: given with changes, it isn't asked.
 */
function proposeChangesTool(anchor: boolean, ask = false, story = false): ToolSpec {
  const words = anchor
    ? "edit: `paragraph` (its [n] from read_scene), `find` (the words there; quotes and spacing needn't match exactly), `occurrence` if they occur more than once in it, `replace` ('' cuts). One paragraph only, and it can't add or remove italics.\n- rewrite: `replace_paragraphs: [from, to]` for whole paragraphs, or `start` + `paragraph` and `end` for a passage that starts or ends inside one; `replace` is the whole new passage, a blank line between paragraphs and *asterisks* for italics."
    : "edit: `find` (copied exactly from the scene, inside one paragraph, long enough to occur once) and `replace` ('' cuts). It can't add or remove italics.\n- rewrite: `start` and `end` (the passage's first and last few words, copied exactly; `start` must occur once) and `replace`, the whole new passage, a blank line between paragraphs and *asterisks* for italics."
  return {
    name: 'propose_changes',
    description: [
      'Propose changes for the writer to apply: one or several, each in `changes` with its `kind` and that kind’s fields. This is the tool for every propose_ change: where your instructions say propose_edit, propose_rewrite, propose_scene_card, propose_entry_change, propose_new_entry, propose_new_scene, propose_new_chapter or propose_rename, give a change of kind edit, rewrite, card, entry, new_entry, new_scene, new_chapter or rename here. The writer sees each and decides; nothing changes unless they apply it. Each change is checked on its own: the result says which were proposed and why any were not. Changes to words must not overlap: all the fixes in one sentence go in one change. Every change needs `why`, a short reason in plain words; `scene` names a scene ("Ch 2, Sc 1" or its title), left out for the open one.',
      `- ${words}`,
      '  Either may give `revises`: the number of an earlier change in this answer it takes the place of.',
      "- card: new values for parts of a scene's card (`goal`, `conflict`, `outcome`, `mood`, `when`, `notes`, `beats` as the whole list).",
      '- entry: an existing entry by `name`, with new `summary`, `description`, `aliases` or `fields` (by the keys get_entry shows).',
      '- new_entry: `entry_kind`, `name`, and `summary` / `description` if you have them.',
      '- new_scene: at the end of `chapter` ("Ch 2" or its title), with `title`, and `goal` / `beats` if you have them.',
      '- new_chapter: `title`, at the end of this story.',
      '- rename: a `scene` or a `chapter`, and its new title as `to`.',
      ...(story ? STORY_KIND_LINES : []),
      ...(ask
        ? [
            "- ask: instead of proposing, ask the writer one short question, only when you can't tell which passage is meant or two readings would give clearly different changes (never to ask permission). Give `question` and 2 to 4 `options`, each with a short `label` (and `detail` if it needs one); `recommended` is the number of the option you would pick (1 = the first); `multi` is true when more than one may be picked. No `why`. It ends your answer: their pick comes back as their next message. An ask goes alone, as the only item: given with changes, it is not asked and the changes are checked as usual."
          ]
        : [])
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: [...Object.keys(CHANGE_KINDS), ...(story ? Object.keys(STORY_CHANGE_KINDS) : []), ...(ask ? [ASK_KIND] : [])] },
              ...(ask
                ? {
                    question: str,
                    options: {
                      type: 'array',
                      items: { type: 'object', properties: { label: str, detail: str }, required: ['label'] },
                      description: 'For an ask: 2 to 4 options.'
                    },
                    recommended: num,
                    multi: { type: 'boolean' }
                  }
                : {}),
              scene: str,
              ...(anchor ? { paragraph: paragraphParam, occurrence: occurrenceParam, replace_paragraphs: rangeParam } : {}),
              find: str,
              replace: str,
              start: str,
              end: str,
              revises: str,
              goal: str,
              conflict: str,
              outcome: str,
              mood: str,
              when: str,
              notes: str,
              beats: { type: 'array', items: str },
              name: str,
              entry_kind: { type: 'string', enum: [...ENTRY_KINDS] },
              summary: str,
              description: str,
              aliases: { type: 'array', items: str },
              fields: { type: 'object', additionalProperties: str },
              chapter: str,
              title: str,
              to: str,
              ...(story ? STORY_ITEM_PROPERTIES : {}),
              why: str
            },
            // An ask has no `why`: only `kind` is required of every item then (a change without `why` is still told so).
            required: ask ? ['kind'] : ['kind', 'why']
          }
        }
      },
      required: ['changes']
    }
  }
}

/** ask_user (ASKUSER): one question with options, which ends the answer. */
const ASK_USER: ToolSpec = {
  name: 'ask_user',
  description:
    "Ask the writer one short question with 2 to 4 options, when what they want could be clearly different things and guessing wrong would waste their time (never to ask permission, nor for something you can decide). It ends your answer: their pick comes back as their next message. Give each option a short `label` (and `detail` if it needs one); `recommended` is the number of the option you would pick (1 = the first); `multi` is true when more than one may be picked.",
  parameters: {
    type: 'object',
    properties: {
      question: str,
      options: {
        type: 'array',
        items: { type: 'object', properties: { label: str, detail: str }, required: ['label'] },
        description: '2 to 4 options.'
      },
      recommended: num,
      multi: { type: 'boolean' }
    },
    required: ['question', 'options']
  }
}

export const DRAFT_MODES: DraftMode[] = ['generate', 'add_below', 'continue', 'redo_beat']

/** propose_draft (DRAFT): new prose for the writer's own drafting to write, once the writer applies it. */
const PROPOSE_DRAFT: ToolSpec = {
  name: 'propose_draft',
  description:
    "Propose new prose for the scene, written by the app's own drafting once the writer applies it (use this when asked to write new prose for a scene, instead of writing it in your answer). `mode`: 'generate' drafts the whole scene from its card; 'add_below' writes on after the scene's last words; 'continue' carries on from the end of paragraph `at_paragraph` (its [n] from read_scene; left out, the scene's end); 'redo_beat' redoes the card's beat number `beat`. `direction` says what should happen and how, in plain words (the writer sees it); `length` is the words to aim for, if it matters. Nothing is written unless the writer applies it.",
  parameters: {
    type: 'object',
    properties: {
      scene: optionalScene,
      mode: { type: 'string', enum: DRAFT_MODES },
      direction: str,
      beat: num,
      at_paragraph: num,
      length: num,
      why: { type: 'string', description: 'A short reason, in plain words.' },
      revises: { type: 'string', description: 'The number of an earlier draft in this answer that this one takes the place of.' }
    },
    required: ['mode', 'direction']
  }
}

const SEPARATE_PROPOSALS = new Set<string>(Object.values(CHANGE_KINDS))

/**
 * The tools offered for one answer, by the lab switches (all off: EDITOR_TOOLS, as before). TOOLCHOICE offers
 * propose_changes instead of the separate propose_* tools; ANCHOR numbers read_scene's paragraphs and lets edits and
 * rewrites name them; ASKUSER adds ask_user, DRAFT propose_draft.
 */
export function editorTools(s: ToolSwitches): ToolSpec[] {
  const out: ToolSpec[] = []
  for (const t of EDITOR_TOOLS) {
    if (s.toolChoice && SEPARATE_PROPOSALS.has(t.name)) continue
    if (s.anchor && t.name === 'read_scene') out.push(READ_SCENE_ANCHORED)
    else if (s.anchor && t.name === 'propose_edit') out.push(EDIT_ANCHORED)
    else if (s.anchor && t.name === 'propose_rewrite') out.push(REWRITE_ANCHORED)
    else if (s.storyTools && t.name === 'scene_issues') out.push(...storyReadTools(s.toolChoice))
    else if (s.storyTools && t.name === 'propose_scene_card') out.push(SCENE_CARD_WITH_NAMES)
    else out.push(t)
  }
  // STORYTOOLS without TOOLCHOICE: the story kinds as their own propose_ tools.
  if (s.storyTools && !s.toolChoice) out.push(...storyProposeTools())
  if (s.toolChoice) out.push(proposeChangesTool(s.anchor, s.askUser, !!s.storyTools))
  if (s.draft) out.push(PROPOSE_DRAFT)
  if (s.askUser) out.push(ASK_USER)
  return out
}

/** A proposal before it has its number and status. */
export type NewProposal = Proposal extends infer P ? (P extends Proposal ? Omit<P, 'id' | 'status'> : never) : never

/** Where the chat was asked: the story and the scene open then. */
export interface AgentPlace {
  storyId: ID | null
  sceneId: ID | null
  prefs: WritingPrefs
  /** What the question asks for, decided before the model runs (the chat overhaul's routing); left out: unknown. */
  intent?: AskIntent
  /**
   * The question already carries the words to change (an "Ask about this" quote), so with TOOLCHOICE and an edit the
   * first request may already be made to propose, without a read_scene first.
   */
  wordsInQuestion?: boolean
  /**
   * The question asks for new prose in the open scene ("write the next bit", "continue from here"; route.ts
   * asksForNewProse): with DRAFT and ACTFIRST, the request made to call a tool asks for propose_draft, not
   * propose_changes (made to call propose_changes, DeepSeek proposed a new scene instead).
   */
  newProse?: boolean
}

/** Something the model got wrong that it can put right (a scene it named that isn't there, words that aren't in it). */
class Mistake extends Error {}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[… cut short: ${s.length - max} more characters]` : s)
const lower = (s: string): string => s.trim().toLocaleLowerCase()
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** A whole number the model gave (as a number, or a string of digits), or undefined. */
const intArg = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : undefined

/** "Ch 2, Sc 1" for a scene of the outline. */
function sceneLabelIn(o: Outline, sceneId: ID): string {
  const s = o.scenes.find((x) => x.id === sceneId)
  if (!s) return 'a scene'
  const ch = o.chapters.findIndex((c) => c.id === s.chapterId)
  const n = o.scenes.filter((x) => x.chapterId === s.chapterId).findIndex((x) => x.id === sceneId)
  const title = s.title.trim() ? ` “${s.title.trim()}”` : ''
  return `Ch ${ch + 1}, Sc ${n + 1}${title}`
}

/** "X", "X or Y", "X, Y or Z". */
const orList = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

/** Every way of choosing `k` of the items, keeping their order. */
function* subsets<T>(items: T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield []
    return
  }
  for (let i = from; i <= items.length - k; i++) for (const rest of subsets(items, k - 1, i + 1)) yield [items[i], ...rest]
}

// ---------- A scene's words, with its italics ----------

/**
 * A scene's words as the chat sees them: its plain text (what proposals look for, as the page's search does) and
 * the same words with *asterisks* around italics (what read_scene shows, as propose_rewrite writes them), with
 * where each character of one is in the other.
 */
export interface SceneWords {
  plain: string
  marked: string
  /** Whether each character of `plain` is in italics. */
  italic: boolean[]
  /** For each character of `marked` (and its end), the place in `plain` (an asterisk: the character after it). */
  toPlain: number[]
  /** For each character of `plain` (and its end), the place in `marked`. */
  toMarked: number[]
  /** Its paragraphs (a scene break's too), with their stable ids when the page has them (ANCHOR's numbering). */
  paras: Para[]
}

/** Plain words with *asterisks* around each run of italics (never across a line, never around spaces at its edges). */
export function markItalics(plain: string, italic: boolean[]): Omit<SceneWords, 'plain' | 'italic' | 'paras'> {
  let marked = ''
  const toPlain: number[] = []
  const toMarked: number[] = []
  const on = (i: number): boolean => !!italic[i] && plain[i] !== '\n'
  let i = 0
  while (i < plain.length) {
    if (on(i) && /\S/.test(plain[i])) {
      let end = i
      while (end < plain.length && on(end)) end++
      while (end > i && /\s/.test(plain[end - 1])) end--
      toPlain.push(i)
      marked += '*'
      for (let k = i; k < end; k++) {
        toMarked[k] = marked.length
        toPlain.push(k)
        marked += plain[k]
      }
      toPlain.push(end)
      marked += '*'
      i = end
      continue
    }
    toMarked[i] = marked.length
    toPlain.push(i)
    marked += plain[i]
    i++
  }
  toMarked[plain.length] = marked.length
  toPlain.push(plain.length)
  return { marked, toPlain, toMarked }
}

type DocNode = { type?: string; text?: string; attrs?: { pid?: unknown }; marks?: { type?: string }[]; content?: DocNode[] }

/**
 * Which characters of a scene's text are in italics, and its paragraphs with their stable ids, from its stored page:
 * walked as the page's text is made (shared/findReplace.ts docText: paragraphs a blank line apart, scene breaks
 * "* * *"). Null when the page and the text don't agree (an old scene with no page), so nothing is marked.
 */
function italicsOf(doc: unknown, text: string): { italic: boolean[]; paras: Para[] } | null {
  if (!doc || typeof doc !== 'object') return null
  const blocks: { t: string; it: boolean[]; pid: string | null; rule: boolean }[] = []
  const visit = (n: DocNode): void => {
    if (n.type === 'horizontalRule') {
      blocks.push({ t: '* * *', it: [false, false, false, false, false], pid: null, rule: true })
      return
    }
    const kids = Array.isArray(n.content) ? n.content : []
    if (n.type !== 'text' && (['paragraph', 'heading', 'codeBlock'].includes(n.type ?? '') || kids.some((c) => c.type === 'text'))) {
      let t = ''
      const it: boolean[] = []
      for (const c of kids) {
        if (c.type === 'text' && typeof c.text === 'string') {
          const on = (c.marks ?? []).some((m) => m?.type === 'italic')
          t += c.text
          for (let k = 0; k < c.text.length; k++) it.push(on)
        } else if (c.type === 'hardBreak') {
          t += '\n'
          it.push(false)
        }
      }
      const pid = typeof n.attrs?.pid === 'string' && n.attrs.pid ? n.attrs.pid : null
      if (t.trim()) blocks.push({ t, it, pid, rule: false })
      return
    }
    kids.forEach(visit)
  }
  ;(Array.isArray((doc as DocNode).content) ? (doc as DocNode).content! : []).forEach(visit)
  const plain = blocks.map((b) => b.t).join('\n\n')
  if (plain !== text) return null
  const paras: Para[] = []
  let at = 0
  let n = 0
  for (const b of blocks) {
    paras.push({ n: b.rule ? 0 : ++n, pid: b.pid, from: at, to: at + b.t.length })
    at += b.t.length + 2
  }
  return { italic: blocks.flatMap((b, i) => (i ? [false, false, ...b.it] : b.it)), paras }
}

/** A scene's words, plain and with its italics marked; null when the scene is gone. */
function sceneWords(db: DB, sceneId: ID): (SceneWords & { title: string }) | null {
  const s = sceneText(db, sceneId)
  if (!s) return null
  let doc: unknown = null
  try {
    doc = repo.getScene(db, sceneId).doc
  } catch {
    doc = null
  }
  const page = italicsOf(doc, s.text)
  const italic = page?.italic ?? Array.from({ length: s.text.length }, () => false)
  return { title: s.title, plain: s.text, italic, ...markItalics(s.text, italic), paras: page?.paras ?? parasOfPlain(s.text) }
}

/** The words of a plain range with their italics marked (balanced, whatever the range cuts). */
const markedSlice = (w: SceneWords, from: number, to: number): string => markItalics(w.plain.slice(from, to), w.italic.slice(from, to)).marked

/** Where a waiting change to words or a passage is in the scene's plain text, or null when its words aren't there. */
function rangeOf(p: Proposal, hay: string): [number, number] | null {
  if (p.kind === 'text') {
    const at = hay.indexOf(p.find)
    return at < 0 ? null : [at, at + p.find.length]
  }
  if (p.kind === 'passage') {
    const at = hay.indexOf(p.start)
    const endAt = at < 0 ? -1 : hay.indexOf(p.end, at + p.start.length)
    return endAt < 0 ? null : [at, endAt + p.end.length]
  }
  return null
}

// ---------- This story's point (rule C6) ----------

/** An entry the chat can name here, with drafting's label and whether only its name may be given. */
export interface SeenEntry {
  e: EntryState
  /** "not in the story yet at this point" or "from Book 1, not in this story so far"; null when it is here. */
  label: string | null
  nameOnly: boolean
}

/** Where a scene the chat may read stands. */
export interface ScenePlace {
  storyId: ID
  /** "Book 1, Ch 2, Sc 3". */
  label: string
  later: boolean
  open: boolean
}

/**
 * What the chat may see from where it was asked, as the briefing has it (context.ts): the memory as of the open
 * scene (the story's end with none, the world as set up with no story), along this story's line only.
 */
export interface StoryView {
  point: AskPoint
  /** Entries Adam keeps out here ('hide' pins): never shown unless named exactly. */
  hidden: Set<ID>
  /** Scenes on this story's line up to the point, and this story's later scenes (marked later). */
  scenes: Map<ID, ScenePlace>
  /** Chapters on the line: 'done' (the line has it all), 'open' (it has some) or 'later'. */
  chapters: Map<ID, 'done' | 'open' | 'later'>
  /** Stories on the line, with whether the line has all of each. */
  stories: Map<ID, boolean>
  /** Entries visible here, by id. */
  entries: Map<ID, SeenEntry>
}

/** The pins that apply where the chat was asked: the scene's own, the story's and the world's (as context.ts reads them). */
function pinsAt(db: DB, point: AskPoint): Pin[] {
  if (point.sceneId) return mem.pinsForScene(db, point.sceneId)
  const any = point.story ? point.story.chapters.flatMap((c) => c.scenes)[0]?.id : undefined
  return mem.pinsForScene(db, any ?? '').filter((p) => p.scope !== 'scene')
}

function storyView(db: DB, storyId: ID | null, sceneId: ID | null): StoryView {
  const shape = loadShape(db)
  const point = askPoint(db, storyId, sceneId, shape, loadMemoryData(db))
  const hidden = new Set([...effectivePins(pinsAt(db, point)).values()].filter((p) => p.action === 'hide').map((p) => p.entryId))
  const scenes = new Map<ID, ScenePlace>()
  const chapters = new Map<ID, 'done' | 'open' | 'later'>()
  const stories = new Map<ID, boolean>()
  const from = point.story ? askedFrom(shape, storyId, sceneId) : null
  if (point.story && from) {
    const label = labeler(shape)
    const line = lineAt(shape, from.at)
    for (const step of line.steps) {
      if (step.type === 'scene') {
        scenes.set(step.sceneId, { storyId: step.storyId, label: label({ storyId: step.storyId, sceneId: step.sceneId }), later: false, open: step.sceneId === point.sceneId })
        chapters.set(step.chapterId, 'open')
      } else if (step.type === 'chapter-end') chapters.set(step.chapterId, 'done')
    }
    for (const seg of line.segments) stories.set(seg.storyId, seg.whole)
    for (const c of point.story.chapters) {
      if (!chapters.has(c.id)) chapters.set(c.id, 'later')
      for (const sc of c.scenes) {
        if (!scenes.has(sc.id)) scenes.set(sc.id, { storyId: point.story.id, label: label({ storyId: point.story.id, sceneId: sc.id }), later: true, open: false })
      }
    }
  }
  const entries = new Map<ID, SeenEntry>()
  for (const e of point.here.values()) entries.set(e.id, { e, label: null, nameOnly: false })
  for (const e of point.later.values()) if (!entries.has(e.id)) entries.set(e.id, { e, label: NOT_YET, nameOnly: false })
  for (const x of point.elsewhere.values()) if (!entries.has(x.entry.id)) entries.set(x.entry.id, { e: x.entry, label: x.label, nameOnly: true })
  return { point, hidden, scenes, chapters, stories, entries }
}

/** True when the words name the entry: its name or an alias, whole, among them. */
function namesEntry(words: string, e: EntryState): boolean {
  const said = ` ${plainWords(fold(words))} `
  return [e.name, ...(e.aliases ?? [])].some((n) => {
    const w = plainWords(fold(n))
    return !!w && said.includes(` ${w} `)
  })
}

/** An entry's words as of the point, each a text search can match. */
const entryTexts = (e: EntryState): string[] =>
  [e.name, ...(e.aliases ?? []), e.summary, e.description, ...(e.tags ?? []), ...Object.values(e.fields ?? {}), ...(e.happened ?? []).map((h) => h.note)].filter(
    (t): t is string => typeof t === 'string' && !!t.trim()
  )

/** The editor chat's tools at work for one question: answers look-ups, notes proposals. */
export class EditorAgent {
  readonly proposals: Proposal[] = []
  private outlineCache: Outline | null = null
  private viewCache: StoryView | null = null
  private shapeCache: WorldShape | null = null
  /** What a name the model gave was taken to mean, said at the top of the call's result ("Using Ch 3, Sc 2 “The Ford”"). */
  private notes: string[] = []
  /** The chat overhaul's switches, read once for the answer. */
  readonly switches: ToolSwitches
  /** The tools offered on every request of this answer (the same list each time, so a provider's cache keeps it). */
  readonly tools: ToolSpec[]
  /** The question the chat asked the writer with ask_user (ASKUSER): the answer ends there. */
  choice: AskChoice | null = null
  /** A scene's words were read (read_scene), so a proposal can be asked for (TOOLCHOICE). */
  private wordsRead = false
  /** The one request of the answer made to propose was asked for already (TOOLCHOICE). */
  private forced = false
  /** What the call being answered was for and how it went, said by its tool where it knows better than the defaults. */
  private mark: { summary?: string; outcome?: string; status?: ToolStatus; kind?: ToolKind } = {}
  /** Calls the model has started asking for in the request being written (by their place in it), not answered yet. */
  private started = new Map<number, ToolActivity>()
  /** Calls made so far in this answer (for their ids). */
  private callCount = 0

  constructor(
    private readonly db: DB,
    private readonly place: AgentPlace,
    /** Told of each step and each new proposal as they happen. */
    private readonly onStep: (label: string) => void,
    private readonly onProposals: (all: Proposal[]) => void,
    /** Told when the chat asks the writer a question with options (ask_user, ASKUSER). */
    private readonly onChoice?: (choice: AskChoice) => void,
    /** Told when a tool call starts (the model began asking for it) and when it ends (chat Phase 2b's tool rows). */
    private readonly onTool?: (phase: 'start' | 'end', call: ToolActivity) => void
  ) {
    this.switches = toolSwitches()
    this.tools = editorTools(this.switches)
  }

  /**
   * The tool the next request must call (TOOLCHOICE), or null: propose_changes, once per answer, for a question routed
   * as an edit, once the scene's words are known (read, or quoted in the question), while nothing has been proposed
   * and no question asked. Asking marks it used. A forced call can still ask the writer (an item of kind ask, ASKUSER).
   * With ACTFIRST and DRAFT, a request for new prose in the open scene (place.newProse) is made to call propose_draft.
   */
  forceTool(): string | null {
    if (!this.switches.toolChoice || this.forced || this.place.intent !== 'edit') return null
    if (this.proposals.length || this.choice || !(this.wordsRead || this.place.wordsInQuestion)) return null
    this.forced = true
    return this.switches.actFirst && this.switches.draft && this.place.newProse ? 'propose_draft' : 'propose_changes'
  }

  /** The scene's words are known: read with read_scene this answer, or quoted in the question. */
  knowsWords(): boolean {
    return this.wordsRead || !!this.place.wordsInQuestion
  }

  /**
   * ACTFIRST: an edit asking the writer which passage before any words are read, with a scene open, is sent back once
   * (DeepSeek asked "which grey shawl?" and "which scene?" without reading the open scene). After reading it may ask.
   */
  private askedBeforeReading = false
  private askTooSoon(): string | null {
    if (!this.switches.actFirst || this.place.intent !== 'edit' || !this.place.sceneId || this.knowsWords() || this.askedBeforeReading) return null
    this.askedBeforeReading = true
    return 'Read the words first: read_scene gives the open scene (or another, by name) with its paragraphs numbered. The open scene is the one meant unless the writer names another. Then propose your best single version; ask only if, after reading, two readings would still give clearly different changes.'
  }

  /**
   * Once the chat has asked the writer a question with options (ask_user): the words that end the answer (the question
   * and its numbered options, for a window that shows only the text); null while the answer goes on.
   */
  ended(): string | null {
    const c = this.choice
    if (!c) return null
    const lines = c.options.map((o, i) => `${i + 1}. ${o.label}${o.detail ? ` — ${o.detail}` : ''}${c.recommended === i ? ' (recommended)' : ''}`)
    return [c.question, lines.join('\n'), c.multi ? 'You can pick more than one.' : ''].filter(Boolean).join('\n\n')
  }

  /** Kept with the turn's record: its proposals, and the question it ended with. */
  extraParams(): { proposals?: Proposal[]; choice?: AskChoice } {
    return { ...(this.proposals.length ? { proposals: this.proposals } : {}), ...(this.choice ? { choice: this.choice } : {}) }
  }

  private outline(): Outline {
    if (!this.place.storyId) throw new Mistake('No story is open, so there are no scenes or chapters to look at.')
    this.outlineCache ??= repo.getOutline(this.db, this.place.storyId)
    return this.outlineCache
  }

  /** What the chat may see from where it was asked (worked out once per answer: nothing here writes to the world). */
  private view(): StoryView {
    this.viewCache ??= storyView(this.db, this.place.storyId, this.place.sceneId)
    return this.viewCache
  }

  /** The open scene's place in this story's outline, or -1. */
  private openIndex(): number {
    return this.place.sceneId && this.place.storyId ? this.outline().scenes.findIndex((x) => x.id === this.place.sceneId) : -1
  }

  /** True when a scene of this story comes after the open one. */
  private isLater(sceneId: ID): boolean {
    const open = this.openIndex()
    return open >= 0 && this.outline().scenes.findIndex((x) => x.id === sceneId) > open
  }

  /** A scene's label with its mark: the open scene, or later. */
  private sceneHeading(sceneId: ID): string {
    const label = sceneLabelIn(this.outline(), sceneId)
    if (sceneId === this.place.sceneId) return `${label} ${OPEN_MARK}`
    return this.isLater(sceneId) ? `${label} (${LATER})` : label
  }

  /** A scene of this story by "Ch 2, Sc 1", its number, or its title; the open scene when none is named. */
  private scene(name: unknown): ID {
    const asked = typeof name === 'string' ? name.trim() : ''
    if (!asked) {
      if (this.place.sceneId) return this.place.sceneId
      throw new Mistake('No scene is open. Name one, as "Ch 2, Sc 1" or by its title.')
    }
    const o = this.outline()
    const m = /ch(?:apter)?\.?\s*(\d+)\D+?sc(?:ene)?\.?\s*(\d+)/i.exec(asked)
    if (m) {
      // "Book 1, Ch 2, Sc 1" from a search names another story's scene: only this story's can be read.
      const before = lower(asked.slice(0, m.index).replace(/[,\s]+$/, ''))
      this.shapeCache ??= loadShape(this.db)
      const other = before && this.shapeCache.stories.find((s) => s.id !== this.place.storyId && lower(s.title) === before)
      if (other) throw new Mistake(`That scene is in ${other.title}. Only this story's scenes (${o.story.title}) can be read here; its summary is what the search showed.`)
      const ch = o.chapters[Number(m[1]) - 1]
      const sc = ch ? o.scenes.filter((x) => x.chapterId === ch.id)[Number(m[2]) - 1] : undefined
      if (sc) return sc.id
    }
    const want = lower(asked.replace(/^[“"]|[”"]$/g, ''))
    const exact = o.scenes.find((x) => lower(x.title) === want)
    if (exact) return exact.id
    const near = o.scenes.filter((x) => x.title.trim() && lower(x.title).includes(want))
    if (near.length) {
      const also = near.length > 1 ? ` (also matching: ${near.slice(1, 4).map((x) => sceneLabelIn(o, x.id)).join('; ')})` : ''
      this.notes.push(`Using ${sceneLabelIn(o, near[0].id)} for “${asked}”${also}.`)
      return near[0].id
    }
    throw new Mistake(`There is no scene “${asked}” in this story. Use the outline tool to see the scenes.`)
  }

  /** A chapter of this story by "Ch 2" or its title. */
  private chapter(name: unknown): ID {
    const asked = typeof name === 'string' ? name.trim() : ''
    const o = this.outline()
    const m = /^ch(?:apter)?\.?\s*(\d+)$/i.exec(asked)
    if (m && o.chapters[Number(m[1]) - 1]) return o.chapters[Number(m[1]) - 1].id
    const want = lower(asked)
    const exact = o.chapters.find((c) => lower(c.title) === want)
    if (exact) return exact.id
    const near = want ? o.chapters.find((c) => c.title.trim() && lower(c.title).includes(want)) : undefined
    if (near) {
      this.notes.push(`Using Ch ${o.chapters.indexOf(near) + 1} “${near.title.trim()}” for “${asked}”.`)
      return near.id
    }
    throw new Mistake(`There is no chapter “${asked}” in this story. Use the outline tool to see the chapters.`)
  }

  /**
   * An entry by its name or one of its aliases, among those this story can see here (rule C6). A name or alias given
   * whole wins (and reaches an entry Adam keeps out here, as a question naming it does); part of a name that fits
   * several is asked about, never guessed.
   */
  private entry(name: unknown): SeenEntry {
    const asked = typeof name === 'string' ? squash(name) : ''
    const want = lower(asked)
    if (!want) throw new Mistake('Name the entry.')
    const all = [...this.view().entries.values()]
    const names = (s: SeenEntry): string[] => [s.e.name, ...(s.e.aliases ?? [])].map(lower).filter(Boolean)
    const exact = all.find((s) => lower(s.e.name) === want) ?? all.find((s) => names(s).includes(want))
    if (exact) return exact
    const hidden = this.view().hidden
    const near = all.filter((s) => !hidden.has(s.e.id) && names(s).some((n) => n.includes(want)))
    if (near.length === 1) {
      this.notes.push(`Using ${near[0].e.name} for “${asked}”.`)
      return near[0]
    }
    if (near.length > 1) {
      const shown = near
        .map((s) => s.e.name)
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .slice(0, 6)
      throw new Mistake(`“${asked}” fits more than one entry. Did you mean ${orList(shown)}? Ask again with the full name.`)
    }
    throw new Mistake(`There is no entry called “${asked}” in this story's memory. Search for it, or propose a new entry.`)
  }

  private propose(p: NewProposal, revises?: Proposal): string {
    const why = squash(p.why).slice(0, 300)
    if (revises) {
      const i = this.proposals.indexOf(revises)
      this.proposals[i] = { ...p, id: revises.id, status: 'pending', why } as Proposal
      this.onProposals([...this.proposals])
      return `Change ${revises.id} now proposes this instead. Nothing has changed yet: it happens only if the writer applies it.`
    }
    const proposal = { ...p, id: String(this.proposals.length + 1), status: 'pending', why } as Proposal
    this.proposals.push(proposal)
    this.onProposals([...this.proposals])
    return `Proposed to the writer as change ${proposal.id}. Nothing has changed yet: it happens only if they apply it. Tell them briefly what you proposed and why.`
  }

  /**
   * Said to the model before its last request, which has no tools: the changes it has proposed, so its answer never
   * tells the writer to apply something that isn't there.
   */
  lastWords(): string {
    const list = this.proposals.map((p) => `change ${p.id}`).join(', ')
    return this.proposals.length
      ? `[AI Write, not the writer] No more tools can be used for this answer. Proposed so far: ${list}. Answer the writer now, mentioning only these; if you meant to propose more, say what they would be and that the writer can ask for them.`
      : "[AI Write, not the writer] No more tools can be used for this answer, and no changes were proposed, so there is nothing for the writer to apply: don't tell them to apply or accept anything. Answer now; if you meant to propose changes, say what they would be and that the writer can ask again."
  }

  /**
   * The model has started asking for a tool (its name has arrived, its arguments are still coming): the call shows as
   * running from now. `slot` is its place among the request's calls; told again of the same slot (the request tried
   * again), it is the same call. `step`: the request of the answer (from 1).
   */
  callStarted(slot: number, name: string, step: number): void {
    if (this.started.has(slot)) return
    this.started.set(slot, this.begin(name, step))
  }

  /** A new call, running from now (said to the window). */
  private begin(name: string, step: number | null): ToolActivity {
    const call: ToolActivity = {
      id: `t${++this.callCount}`,
      tool: name,
      kind: toolKind(name),
      label: '',
      summary: '',
      status: 'running',
      outcome: '',
      startedAt: Date.now(),
      endedAt: null,
      step,
      arguments: '',
      result: ''
    }
    this.onTool?.('start', call)
    return call
  }

  /**
   * Answers one call: what it found, or a plain line on what went wrong. Never throws. `begun`: the call as it was
   * shown starting (callStarted); without it, it starts now.
   */
  run(call: ToolCall, begun?: ToolActivity): { result: string; step: ToolActivity } {
    this.notes = []
    this.mark = {}
    const started = begun ?? this.begin(call.name, null)
    let args: Record<string, unknown> = {}
    try {
      args = call.arguments.trim() ? (JSON.parse(call.arguments) as Record<string, unknown>) : {}
    } catch {
      return this.done(call, started, {}, 'Something went wrong', 'The arguments were not valid JSON. Call the tool again with valid JSON.', {
        status: 'failed',
        outcome: 'the arguments weren’t valid JSON'
      })
    }
    try {
      const [label, result] = this.answer(call.name, args)
      return this.done(call, started, args, label, result)
    } catch (e) {
      const message = e instanceof Mistake ? e.message : `That didn't work: ${(e as Error)?.message ?? e}`
      const why = shortReason(message)
      // A proposal that didn't go through says so, so the model doesn't tell the writer it is waiting for them.
      if (call.name.startsWith('propose_'))
        return this.done(call, started, args, 'A change that didn’t fit', `Not proposed: nothing is waiting for the writer. ${message}`, {
          status: 'not-proposed',
          outcome: `not proposed: ${why}`
        })
      if (call.name === 'ask_user' && this.switches.askUser)
        return this.done(call, started, args, 'A question that didn’t fit', `Not asked: the writer hasn't seen it. ${message}`, {
          status: 'failed',
          outcome: `not asked: ${why}`
        })
      return this.done(call, started, args, 'Looking something up', message, { status: 'failed', outcome: why })
    }
  }

  private done(
    call: ToolCall,
    started: ToolActivity,
    args: Record<string, unknown>,
    label: string,
    said: string,
    how: { status?: ToolStatus; outcome?: string } = {}
  ): { result: string; step: ToolActivity } {
    // What a partial name was taken to mean, so the model can tell if it wasn't the one meant: first, except after a
    // proposal's "Proposed to the writer" / "Not proposed", which always opens its answer (prompts.ts).
    const note = this.notes.join(' ')
    const result = !note ? said : call.name.startsWith('propose_') ? `${said}\n(${note})` : `${note}\n\n${said}`
    this.notes = []
    const kind = this.mark.kind ?? toolKind(call.name)
    // A single change's own words say what it is ("Proposing a rewrite of Ch 1, Sc 2" → "a rewrite of Ch 1, Sc 2").
    const proposing = /^Proposing (.+)$/.exec(label)?.[1]
    const revising = /^Revising change (\S+)$/.exec(label)?.[1]
    const fromLabel = proposing ? proposing.charAt(0).toLowerCase() + proposing.slice(1) : revising ? `a new version of change ${revising}` : ''
    const step: ToolActivity = {
      ...started,
      tool: call.name,
      kind,
      label,
      arguments: call.arguments.slice(0, 2000),
      result: clip(result, 1500),
      summary: this.mark.summary ?? (fromLabel || argSummary(call.name, args)),
      status: how.status ?? this.mark.status ?? 'done',
      outcome: how.outcome ?? this.mark.outcome ?? (kind === 'propose' || kind === 'draft' ? 'proposed' : ''),
      endedAt: Date.now()
    }
    this.mark = {}
    this.onStep(label)
    this.onTool?.('end', step)
    return { result, step }
  }

  /**
   * A search along this story's line (rule C6), each result labelled: entries as of here, scenes up to the open one
   * and this story's later ones (marked later), never another story's, nor what Adam keeps out unless the query names
   * it. When nothing has every word, fewer of them are tried, and the answer says so.
   */
  private search(q: string): string {
    const parsed = parseQuery(q)
    if (!parsed) throw new Mistake('Give the words to search for.')
    const terms = parsed.terms
    const v = this.view()
    const scope = v.point.story
      ? `Searched ${v.point.story.title} as of ${v.point.label}${v.point.sceneId ? ' (the open scene)' : ''}, along its own line only.`
      : 'Searched the world as it was set up (no story is open).'
    let hits = this.searchFor(q, terms, q)
    let note = ''
    for (let k = terms.length - 1; !hits.length && k >= 1; k--) {
      const seen = new Set<string>()
      let tried = 0
      for (const some of subsets(terms, k)) {
        if (tried++ >= 40 || hits.length >= SEARCH_HITS) break
        const query = `${some.map((t) => t.word).join(' ')}${some[some.length - 1].prefix ? '' : ' '}`
        for (const h of this.searchFor(query, some, q)) {
          if (seen.has(h.key)) continue
          seen.add(h.key)
          hits.push({ key: h.key, line: `${h.line} [has: ${some.map((t) => t.word).join(', ')}]` })
        }
      }
      if (hits.length) note = `Nothing matched all ${terms.length} words; these match ${k} of ${terms.length}.`
    }
    hits = hits.slice(0, SEARCH_HITS)
    this.mark.outcome = hits.length ? counted(hits.length, 'hit') : 'nothing found'
    if (!hits.length) return `Nothing found. ${scope}`
    return [scope, note, hits.map((h) => h.line).join('\n')].filter(Boolean).join('\n')
  }

  /** One search's results the chat may see here, a labelled line each. `asked` is the model's own query. */
  private searchFor(query: string, terms: Term[], asked: string): { key: string; line: string }[] {
    const v = this.view()
    const res = searchIndex(this.db).search(query, { limit: 8, storyId: v.point.story?.id ?? null })
    const out: { key: string; line: string }[] = []
    for (const g of res.groups) {
      for (const h of g.hits) {
        const line = this.hitLine(h, terms, asked)
        if (line) out.push({ key: h.key, line })
      }
    }
    return out.slice(0, SEARCH_HITS)
  }

  /** A scene's label for the chat ("Ch 2, Sc 1 “The Ford”" in this story) with its mark; '' when it isn't one it may see. */
  private sceneLine(sceneId: ID, title: string): string {
    const place = this.view().scenes.get(sceneId)
    if (!place) return ''
    const here = this.place.storyId ? this.outline().scenes.some((x) => x.id === sceneId) : false
    const label = here ? sceneLabelIn(this.outline(), sceneId) : `${place.label}${title.trim() ? ` “${title.trim()}”` : ''}`
    return `${label}${place.open ? ` ${OPEN_MARK}` : place.later ? ` (${LATER})` : ''}`
  }

  private hitLine(h: SearchHit, terms: Term[], asked: string): string | null {
    const v = this.view()
    const flat = (parts: { text: string }[]): string => parts.map((p) => p.text).join('')
    const snip = flat(h.snippet).replace(/\s+/g, ' ').trim()
    const tail = snip ? `: ${snip}` : ''
    const title = flat(h.title)
    const id = h.key.split(':').at(-1) ?? ''
    const open = h.open
    if (open.kind === 'entry') {
      const seen = v.entries.get(open.entryId)
      if (!seen || (v.hidden.has(seen.e.id) && !namesEntry(asked, seen.e))) return null
      const tag = [KIND_LABELS[seen.e.kind]?.one.toLowerCase() ?? 'entry', seen.label].filter(Boolean).join('; ')
      // Adam's own notes on the entry, not the story's events.
      if (h.key.startsWith('note:')) return seen.nameOnly ? null : `- Private notes on ${seen.e.name} (${tag})${tail}`
      const names = [seen.e.name, ...(seen.e.aliases ?? [])].filter((n) => n.trim())
      if (seen.nameOnly) return matchesAll(names.map(fold), terms) ? `- ${seen.e.name} (${tag})` : null
      // The index holds what every story did to it: the words must be in what it is here.
      const texts = entryTexts(seen.e)
      if (!matchesAll(texts.map(fold), terms)) return null
      const count = (t: string): number => terms.filter((x) => matchesAll([fold(t)], [x])).length
      const best = [...texts].sort((a, b) => count(b) - count(a))[0]
      const shown = names.includes(best) ? seen.e.summary.trim() : best
      const sn = shown ? flat(snippet(shown, terms, 140).parts).replace(/\s+/g, ' ').trim() : ''
      return `- ${seen.e.name} (${tag})${sn ? `: ${sn}` : ''}`
    }
    if (open.kind === 'scene' && (h.key.startsWith('scene:') || h.key.startsWith('note:scene:') || h.key.startsWith('summary:scene:'))) {
      const label = this.sceneLine(open.sceneId, title)
      if (!label) return null
      if (h.key.startsWith('note:')) return `- Notes for the AI on ${label}${tail}`
      if (h.key.startsWith('summary:')) return `- Scene summary of ${label}${tail}`
      return `- Scene ${label}${tail}`
    }
    if (h.key.startsWith('summary:chapter:') || h.key.startsWith('chapter:')) {
      const state = v.chapters.get(id)
      if (!state) return null
      // A chapter's summary tells it all; its title and goal are later only when none of it has happened.
      const later = h.key.startsWith('summary:') ? state !== 'done' : state === 'later'
      const what = h.key.startsWith('summary:') ? h.detail : `Chapter ${h.detail}`
      return `- ${what} “${title}”${later ? ` (${LATER})` : ''}${tail}`
    }
    if (h.key.startsWith('summary:story:') || h.key.startsWith('story:')) {
      const whole = v.stories.get(id)
      if (whole === undefined) return null
      const own = id === v.point.story?.id
      if (h.key.startsWith('summary:')) {
        // Another story's whole summary only when the line has all of it; this story's tells what comes later too.
        if (!own && !whole) return null
        return `- Story summary of ${title}${own && !whole ? ` (${LATER})` : ''}${tail}`
      }
      return `- Story: ${title}${tail}`
    }
    if (open.kind === 'style') {
      if (open.storyId && open.storyId !== v.point.story?.id) return null
      return `- ${title} (${h.detail})${tail}`
    }
    // A series' summary covers stories this one may not know.
    return null
  }

  /** An entry as get_entry gives it: as of the point, with drafting's labels, ties and what it knows. */
  private entryText(s: SeenEntry): string {
    const { e, label } = s
    const v = this.view()
    const head = `${KIND_LABELS[e.kind].one}: ${e.name}${label ? ` (${label})` : ''}`
    if (s.nameOnly) return `${head}\nOnly its name is known here: what it is belongs to events this story doesn't know.`
    const where = v.point.story
      ? `As of ${v.point.label}${v.point.sceneId ? ', the open scene' : ', the end of the story so far'}.`
      : 'As the world was set up (no story is open).'
    const changed = (key: string): string =>
      (e.changed ?? []).includes(key) ? ` (changed${e.changedWhere?.[key] ? ` in ${e.changedWhere[key]}` : ' in the story'})` : ''
    const defs = (FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields)
    const value = (k: string): string => (e.fields?.[k] ?? '').trim()
    const fields = defs.filter((f) => value(f.key)).map((f) => `${f.label} [${f.key}]${changed(f.key)}: ${value(f.key)}`)
    const empty = defs.filter((f) => !value(f.key)).map((f) => `${f.label} [${f.key}]`)
    const name = (id: ID): string => v.point.names.get(id) ?? 'Someone'
    const ties = v.point.relationships
      .filter((r) => (r.aId === e.id || r.bId === e.id) && !v.hidden.has(r.aId === e.id ? r.bId : r.aId))
      .map((r) => {
        const parts = [`- ${name(r.aId)} and ${name(r.bId)}: ${r.type.trim() || 'linked'}`]
        if (r.aFeels.trim()) parts.push(`${name(r.aId)} feels: ${r.aFeels.trim()}`)
        if (r.bFeels.trim()) parts.push(`${name(r.bId)} feels: ${r.bFeels.trim()}`)
        return parts.join('. ')
      })
    const knows = v.point.facts.filter((f) => f.knownBy.includes(e.id) && f.fact.trim()).map((f) => `- ${f.fact.trim()}`)
    const t = e.kind === 'thread' ? v.point.threads.find((x) => x.entryId === e.id) : undefined
    const thread = t
      ? t.status === 'resolved'
        ? `Status: paid off${t.paidOff?.trim() ? ` in ${t.paidOff.trim()}` : ''}.`
        : `Status: still open${t.setUp?.trim() ? `, set up in ${t.setUp.trim()}` : ''}.`
      : ''
    return [
      head,
      where,
      e.aliases.length && `Also called: ${e.aliases.join(', ')}`,
      e.summary.trim() && `Summary${changed('summary')}: ${e.summary.trim()}`,
      e.description.trim() && `Description${changed('description')}: ${e.description.trim()}`,
      ...fields,
      thread,
      happenedText(e),
      ties.length && `Relationships:\n${ties.join('\n')}`,
      knows.length && `What ${e.name} knows:\n${knows.join('\n')}`,
      empty.length && `Empty fields: ${empty.join(', ')}`
    ]
      .filter(Boolean)
      .join('\n')
  }

  // ---------- ANCHOR: edits and rewrites found by paragraph and tolerant matching ----------

  /** Why words weren't taken (findWords), in words the model can act on: the closest words quoted exactly, where it can. */
  private notTaken(f: Exclude<Found, { ok: true }>, s: SceneWords, what: string, rewrite: string): Mistake {
    const quote = (from: number, to: number): string => `«${clip(s.plain.slice(from, to).replace(/\n/g, ' '), 300)}»`
    switch (f.why) {
      case 'empty':
        return new Mistake(`${what} are empty. Copy them from the scene.`)
      case 'no-paragraph':
        return new Mistake(`There is no such paragraph: the scene's paragraphs are [1] to [${f.count}]. Read the scene for the numbers.`)
      case 'none':
        return new Mistake(
          f.near
            ? `${what} are not in the scene as written. Did you mean ${quote(f.near.from, f.near.to)} in [${f.near.para.n}]? Call again with those words (and paragraph ${f.near.para.n}).`
            : `${what} are not in the scene as written. Read the scene and copy them from it.`
        )
      case 'many': {
        const where = f.places.map((p) => `[${p.n}]`).join(', ')
        if (f.occurrence != null) return new Mistake(`${what} occur ${f.count} times there, so there is no occurrence ${f.occurrence}. Give \`occurrence\` from 1 to ${f.count}.`)
        return new Mistake(
          `${what} occur ${f.count} times (in ${where}). Give \`paragraph\`${f.places.length < f.count ? ', and `occurrence` when they occur more than once in it (1 = the first)' : ''}, or more of the sentence.`
        )
      }
      case 'spans':
        return new Mistake(
          `${what} run across paragraphs [${f.first.n}] to [${f.last.n}], and an edit stays inside one paragraph. Propose ${rewrite} instead, with \`replace_paragraphs\`: [${f.first.n}, ${f.last.n}].`
        )
    }
  }

  /** What a match that wasn't exact was taken to be, for the call's result. */
  private noteMatch(f: Extract<Found, { ok: true }>, s: SceneWords, asked: number | undefined): void {
    const words = `«${clip(s.plain.slice(f.from, f.to).replace(/\n/g, ' '), 300)}»`
    if (f.how === 'fuzzy') this.notes.push(`Your words differed from the scene's; taken as ${words} in [${f.para.n}].`)
    if (f.how === 'ellipsis') this.notes.push(`Your words were cut with an ellipsis; taken as everything from ${words.slice(0, 60)}… in [${f.para.n}].`)
    if (f.elsewhere && asked != null) this.notes.push(`Those words are in paragraph [${f.para.n}], not [${asked}].`)
  }

  /** Where a waiting change to words or a passage is now (by its anchor when it has one). */
  private rangeNow(p: Proposal, s: SceneWords): [number, number] | null {
    const place = (x: ParaAnchor): number | null => {
      const para = s.paras.find((q) => (x.pid ? q.pid === x.pid : q.n === x.paragraph))
      return para ? para.from + x.offset : null
    }
    if (p.kind === 'text' && p.at) {
      const from = place(p.at)
      return from != null && s.plain.slice(from, from + p.find.length) === p.find ? [from, from + p.find.length] : rangeOf(p, s.plain)
    }
    if (p.kind === 'passage' && p.at) {
      const from = place(p.at.start)
      const to = place(p.at.end)
      return from != null && to != null && to > from ? [from, to] : rangeOf(p, s.plain)
    }
    return rangeOf(p, s.plain)
  }

  /** A waiting change to words or a passage in the scene that [from, to) overlaps (not `skip`). */
  private clashWith(sceneId: ID, s: SceneWords, from: number, to: number, skip?: Proposal): Proposal | undefined {
    return this.proposals.find((p) => {
      if (p === skip || p.status !== 'pending' || (p.kind !== 'text' && p.kind !== 'passage') || p.sceneId !== sceneId) return false
      const r = this.rangeNow(p, s)
      return !!r && r[0] < to && from < r[1]
    })
  }

  private revising(a: Record<string, unknown>, kinds: Proposal['kind'][], what: string): Proposal | undefined {
    const id = (typeof a.revises === 'string' ? a.revises : typeof a.revises === 'number' ? String(a.revises) : '').replace(/\D/g, '')
    if (!id) return undefined
    const p = this.proposals.find((x) => x.id === id)
    if (!p || !kinds.includes(p.kind)) throw new Mistake(`There is no change ${id} to ${what} to revise.`)
    return p
  }

  private editAnchored(a: Record<string, unknown>): [string, string] {
    const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
    const id = this.scene(a.scene)
    const s = sceneWords(this.db, id)
    if (!s) throw new Mistake('That scene no longer exists.')
    const asked = text('find')
    if (!asked.trim()) throw new Mistake('`find` is empty. Copy the words to change from the scene.')
    let replace = text('replace')
    if (replace.includes('\n')) throw new Mistake('An edit stays inside one paragraph, with no line breaks in `replace`. For new paragraphs, propose a rewrite.')
    const paragraph = intArg(a.paragraph)
    const f = findWords(s, s.paras, asked, { paragraph, occurrence: intArg(a.occurrence) })
    if (!f.ok) throw this.notTaken(f, s, 'Those words', this.switches.toolChoice ? 'a change of kind rewrite' : 'a rewrite (propose_rewrite)')
    if (f.how === 'ellipsis' && /\.\.\.|…/.test(replace)) {
      throw new Mistake('`find` was cut short with an ellipsis, so the change replaces all the words between: give `replace` in full, with no ellipsis.')
    }
    const hay = s.plain
    const [at, atEnd] = [f.from, f.to]
    // As propose_edit: applying keeps the words' formatting, so a change into, out of or across italics would lose them.
    const flags = s.italic.slice(at, atEnd)
    const italic = flags.every(Boolean)
    const mixed = !italic && flags.some(Boolean)
    const marks = /\*[^*\n]+\*/.test(replace)
    if (italic && marks && /^\*[^*\n]+\*$/.test(replace.trim())) replace = replace.replace(/\*/g, '')
    else if (mixed || marks) {
      throw new Mistake("Those words run into, out of or across italics (*…*), which an edit can't keep or set. Propose a rewrite of the passage instead: its `replace` keeps *asterisks* as italics.")
    }
    if (hay.slice(at, atEnd) === replace) throw new Mistake('The new words are the same as the old.')
    // The page applies the first place it finds the words (case, quotes and dashes aside): widened a word at a time,
    // inside the paragraph and keeping its formatting, until that is here. The anchor says where, either way.
    let [from, to] = [at, atEnd]
    for (let k = 1; pageFinds(hay, s.paras, hay.slice(from, to)) !== from && k <= 24; k++) {
      const left = wordBefore(hay, f.para, from)
      const right = wordAfter(hay, f.para, to)
      if (left == null && right == null) break
      if (right != null && (k % 2 === 1 || left == null)) to = right
      else if (left != null) from = left
    }
    const sameFormat = [...s.italic.slice(from, at), ...s.italic.slice(atEnd, to)].every((x) => x === italic)
    if (pageFinds(hay, s.paras, hay.slice(from, to)) !== from || !sameFormat) [from, to] = [at, atEnd]
    const find = hay.slice(from, to)
    replace = hay.slice(from, at) + replace + hay.slice(atEnd, to)
    const revises = this.revising(a, ['text'], 'words')
    const clash = this.clashWith(id, s, at, atEnd, revises)
    if (clash?.kind === 'text') {
      throw new Mistake(
        `Those words overlap change ${clash.id} (“${clip(clash.find, 120)}”): once one is applied, the other's words are gone. Make one change covering both, with \`revises\`: "${clash.id}".`
      )
    }
    if (clash) {
      throw new Mistake(
        `Those words are inside the passage change ${clash.id} rewrites: once one is applied, the other's words are gone. Leave this to that rewrite, or revise it.`
      )
    }
    this.noteMatch(f, s, paragraph)
    const label = sceneLabelIn(this.outline(), id)
    const where = anchorAt(s.paras, from)
    return [
      revises ? `Revising change ${revises.id}` : `Proposing an edit to ${label}`,
      this.propose({ kind: 'text', sceneId: id, sceneLabel: label, find, replace, ...(where ? { at: where } : {}), why: text('why') }, revises)
    ]
  }

  private rewriteAnchored(a: Record<string, unknown>): [string, string] {
    const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
    const id = this.scene(a.scene)
    const s = sceneWords(this.db, id)
    if (!s) throw new Mistake('That scene no longer exists.')
    const replace = text('replace').trim()
    if (!replace) throw new Mistake('Give the new passage as `replace`. To cut words, propose an edit with an empty `replace`.')
    const hay = s.plain
    const paras = numbered(s.paras)
    let from: number
    let to: number
    /** Where the matched start words end, and where the end words begin (the words to keep as `start` and `end`). */
    let startTo: number
    let endFrom: number
    const range = Array.isArray(a.replace_paragraphs) ? a.replace_paragraphs : null
    if (range?.length) {
      const x = intArg(range[0])
      const y = intArg(range[range.length - 1])
      const first = paras.find((p) => p.n === x)
      const last = paras.find((p) => p.n === y)
      if (!first || !last || first.n > last.n) {
        throw new Mistake(`\`replace_paragraphs\` is [from, to] by the [n] numbers read_scene shows: the scene's paragraphs are [1] to [${paras.length}].`)
      }
      from = first.from
      to = last.to
      // The first and last few words of the passage, widened below as the page needs.
      startTo = from
      for (let k = 0; k < 6; k++) startTo = wordAfter(hay, first, startTo) ?? startTo
      endFrom = to
      for (let k = 0; k < 6; k++) endFrom = wordBefore(hay, last, endFrom) ?? endFrom
    } else {
      const startAsked = text('start')
      const endAsked = text('end')
      if (!startAsked.trim() || !endAsked.trim()) {
        throw new Mistake("Give `replace_paragraphs: [from, to]` for whole paragraphs, or the passage's first words as `start` (with its `paragraph`) and its last words as `end`.")
      }
      const paragraph = intArg(a.paragraph)
      const fs = findWords(s, s.paras, startAsked, { paragraph, occurrence: intArg(a.occurrence) })
      if (fs.ok) {
        ;[from, startTo] = [fs.from, fs.to]
        this.noteMatch(fs, s, paragraph)
      } else if (fs.why === 'spans') {
        // Start words that run on into the next paragraph: the passage starts where they do.
        ;[from, startTo] = [fs.from, fs.first.to]
      } else throw this.notTaken(fs, s, 'The `start` words', 'replace_paragraphs')
      // The end is looked for after the start words; else (a passage no longer than them) ending with or after them.
      let fe = findWords(s, s.paras, endAsked, { after: startTo, first: true })
      if (!fe.ok && fe.why !== 'spans') {
        const within = findWords(s, s.paras, endAsked, { after: from, first: true })
        if (within.ok && within.to >= startTo) fe = within
      }
      if (fe.ok) {
        ;[endFrom, to] = [fe.from, fe.to]
        this.noteMatch(fe, s, undefined)
      } else if (fe.why === 'spans') {
        ;[endFrom, to] = [fe.last.from, fe.to]
      } else throw this.notTaken(fe, s, 'The `end` words (after the `start` words)', 'replace_paragraphs')
    }
    const firstPara = paraAt(s.paras, from)!
    const lastPara = paraAt(s.paras, to)!
    if (s.paras.some((p) => p.n === 0 && p.from >= from && p.to <= to)) {
      throw new Mistake('That passage runs across a scene break (* * *), which a rewrite can’t. Propose one on each side of it.')
    }
    // `start` and `end` as the page will look for them (findPassage): widened a word at a time until it finds them here.
    for (let k = 0; pageFinds(hay, s.paras, hay.slice(from, startTo)) !== from && k < 24; k++) {
      const next = wordAfter(hay, firstPara, startTo)
      if (next == null || next > to) break
      startTo = next
    }
    const endFound = (): boolean => {
      const words = hay.slice(endFrom, to)
      const after = pageFinds(hay, s.paras, words, startTo)
      if (after != null) return after === endFrom
      return pageFinds(hay, s.paras, words, from) === endFrom && to >= startTo
    }
    for (let k = 0; !endFound() && k < 24; k++) {
      const prev = wordBefore(hay, lastPara, endFrom)
      if (prev == null || prev < from) break
      endFrom = prev
    }
    const start = hay.slice(from, startTo)
    const end = hay.slice(endFrom, to)
    // The old passage as read_scene showed it, italics marked, so only real changes show between old and new.
    const original = markedSlice(s, from, to)
    if (original.replace(/\s+/g, ' ') === replace.replace(/\s+/g, ' ')) throw new Mistake('The new passage is the same as the old.')
    const revises = this.revising(a, ['text', 'passage'], 'words or a passage')
    const clash = this.clashWith(id, s, from, to, revises)
    if (clash) throw new Mistake(`That passage overlaps change ${clash.id}. Make one change covering both instead, with \`revises\`: "${clash.id}".`)
    const label = sceneLabelIn(this.outline(), id)
    const startAt = anchorAt(s.paras, from)
    const endAt = anchorAt(s.paras, to)
    return [
      revises ? `Revising change ${revises.id}` : `Proposing a rewrite of ${label}`,
      this.propose(
        { kind: 'passage', sceneId: id, sceneLabel: label, start, end, original, replace, ...(startAt && endAt ? { at: { start: startAt, end: endAt } } : {}), why: text('why') },
        revises
      )
    ]
  }

  // ---------- TOOLCHOICE: every kind of change in one tool ----------

  private proposeChanges(a: Record<string, unknown>): [string, string] {
    const items = Array.isArray(a.changes) ? (a.changes as unknown[]) : null
    if (!items?.length) throw new Mistake('Give the changes as `changes`: a list, each with its `kind` and that kind’s fields.')
    if (items.length > 20) throw new Mistake('At most 20 changes at once.')
    const kindOf = (raw: unknown): string => {
      const k = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).kind : null
      return typeof k === 'string' ? k.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
    }
    // A question for the writer (ASKUSER), asked as ask_user asks it, when it is the only item: it ends the answer.
    // Beside changes it is not asked (the changes are the answer, checked as usual).
    const asks = this.switches.askUser ? items.filter((x) => kindOf(x) === ASK_KIND).length : 0
    if (asks && asks === items.length) {
      // Shown as asking the writer, as ask_user is.
      this.mark = { kind: 'ask', summary: '' }
      if (asks > 1) {
        this.mark = { kind: 'ask', status: 'failed', outcome: 'not asked: one question at a time' }
        return ['A question that didn’t fit', 'Not asked: the writer hasn’t seen it. Ask one question only: a single item of kind ask.']
      }
      const { kind: _kind, why: _why, ...q } = items[0] as Record<string, unknown>
      try {
        return this.askUser(q)
      } catch (e) {
        if (!(e instanceof Mistake)) throw e
        this.mark = { kind: 'ask', status: 'failed', outcome: `not asked: ${shortReason(e.message)}` }
        return ['A question that didn’t fit', `Not asked: the writer hasn’t seen it. ${e.message}`]
      }
    }
    const reasons: string[] = []
    const lines: string[] = []
    const labels: string[] = []
    let proposed = 0
    items.forEach((raw, i) => {
      const n = i + 1
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
      const kind = kindOf(raw)
      if (asks && kind === ASK_KIND) {
        lines.push(`${n}. ask: Not asked: an ask goes alone, never beside changes.`)
        return
      }
      const kinds: Record<string, string> = this.switches.storyTools ? { ...CHANGE_KINDS, ...STORY_CHANGE_KINDS } : CHANGE_KINDS
      const tool = kinds[kind]
      if (!item || !tool) {
        lines.push(`${n}. Not proposed: each change needs \`kind\`, one of ${Object.keys(kinds).join(', ')}.`)
        reasons.push('no kind given')
        return
      }
      const { kind: _kind, entry_kind: entryKind, ...rest } = item
      const args = kind === 'new_entry' ? { ...rest, kind: entryKind ?? item.entryKind } : rest
      this.notes = []
      let said: string
      try {
        const [label, result] = this.answer(tool, args)
        labels.push(label)
        proposed++
        const revised = /^Change (\d+) now/.exec(result)
        said = revised ? `change ${revised[1]} now proposes this instead.` : `proposed as change ${/change (\d+)/.exec(result)?.[1] ?? '?'}.`
      } catch (e) {
        const message = e instanceof Mistake ? e.message : `That didn't work: ${(e as Error)?.message ?? e}`
        said = `Not proposed. ${message}`
        reasons.push(shortReason(message, 50))
      }
      const note = this.notes.join(' ')
      lines.push(`${n}. ${kind}: ${said}${note ? ` (${note})` : ''}`)
    })
    this.notes = []
    const failed = items.length - asks - proposed
    // "2 proposed, 1 not proposed: those words aren't in the scene".
    const why = reasons[0] ? `: ${reasons[0]}` : ''
    this.mark = {
      summary: changesSummary(items),
      status: proposed ? 'done' : 'not-proposed',
      outcome: proposed ? `${proposed} proposed${failed ? `, ${failed} not proposed${why}` : ''}` : `not proposed${why}`
    }
    const head = proposed
      ? `Proposed to the writer: ${proposed} of ${items.length - asks}. Nothing has changed yet: it happens only if they apply it.${failed ? ' Fix the ones not proposed and call again with only those.' : ''}`
      : 'Not proposed: nothing is waiting for the writer.'
    const tail = proposed ? '\nTell them briefly what you proposed and why.' : ''
    const label = labels.length === 1 ? labels[0] : labels.length ? `Proposing ${labels.length} changes` : 'A change that didn’t fit'
    return [label, `${head}\n${lines.join('\n')}${tail}`]
  }

  // ---------- ASKUSER: one question with options, which ends the answer ----------

  private askUser(a: Record<string, unknown>): [string, string] {
    if (this.choice) throw new Mistake('You have asked the writer a question already; the answer ends with it.')
    const tooSoon = this.askTooSoon()
    if (tooSoon) throw new Mistake(tooSoon)
    const question = squash(typeof a.question === 'string' ? a.question : '')
    if (!question) throw new Mistake('Give the `question`.')
    if (question.length > 400) throw new Mistake('Keep the question short: under 400 characters.')
    const raw = Array.isArray(a.options) ? (a.options as unknown[]) : []
    const options = raw.map((o) => {
      if (typeof o === 'string') return { label: squash(o) }
      const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
      const detail = typeof x.detail === 'string' ? squash(x.detail).slice(0, 300) : ''
      return { label: squash(typeof x.label === 'string' ? x.label : ''), ...(detail ? { detail } : {}) }
    })
    if (options.length < 2 || options.length > 4) throw new Mistake('Give 2 to 4 `options`, each with a `label`.')
    if (options.some((o) => !o.label)) throw new Mistake('Every option needs a `label`.')
    if (options.some((o) => o.label.length > 200)) throw new Mistake('Keep each option’s label short (put the rest in `detail`).')
    if (new Set(options.map((o) => lower(o.label))).size < options.length) throw new Mistake('Two options say the same thing: give clearly different ones.')
    const rec = intArg(a.recommended)
    if (a.recommended != null && (rec == null || rec < 1 || rec > options.length)) {
      throw new Mistake(`\`recommended\` is the number of an option: 1 to ${options.length}.`)
    }
    this.choice = { question, options, ...(rec ? { recommended: rec - 1 } : {}), ...(a.multi === true ? { multi: true } : {}) }
    this.onChoice?.(this.choice)
    this.mark = { kind: 'ask', summary: question, outcome: `asked, ${counted(options.length, 'option')}` }
    return ['Asking you a question', 'Asked the writer. Your answer ends here: their pick comes back as their next message.']
  }

  // ---------- DRAFT: new prose for the writer's own drafting ----------

  private proposeDraft(a: Record<string, unknown>): [string, string] {
    const id = this.scene(a.scene)
    const s = sceneWords(this.db, id)
    if (!s) throw new Mistake('That scene no longer exists.')
    const mode = (typeof a.mode === 'string' ? a.mode.trim().toLowerCase().replace(/[\s-]+/g, '_') : '') as DraftMode
    if (!DRAFT_MODES.includes(mode)) throw new Mistake(`\`mode\` must be one of: ${DRAFT_MODES.join(', ')}.`)
    const direction = (typeof a.direction === 'string' ? a.direction : '').trim()
    if (!direction) throw new Mistake('Give the `direction`: what the new prose should do, in plain words.')
    if (direction.length > 2000) throw new Mistake('Keep the direction under 2,000 characters.')
    if (!s.plain.trim() && mode !== 'generate') {
      throw new Mistake(`The scene has no words yet, so there is nothing to ${mode === 'redo_beat' ? 'redo' : 'carry on from'}: use mode generate.`)
    }
    let beat: { index: number; text: string } | undefined
    if (mode === 'redo_beat') {
      // Numbered as read_scene shows the card's beats (empty ones left out); kept as the card's own place, from 1.
      const beats = repo
        .getScene(this.db, id)
        .card.beats.map((b, i) => ({ b: b.trim(), i }))
        .filter((x) => x.b)
      if (!beats.length) throw new Mistake("This scene's card has no beats to redo. Use add_below or continue instead.")
      const n = intArg(a.beat)
      if (n == null || n < 1 || n > beats.length) throw new Mistake(`Give \`beat\`: the number of the card's beat to redo, 1 to ${beats.length}.`)
      beat = { index: beats[n - 1].i + 1, text: beats[n - 1].b }
    } else if (a.beat != null) throw new Mistake('`beat` is only for redo_beat.')
    let atParagraph: ParaAnchor | undefined
    if (a.at_paragraph != null) {
      if (mode !== 'continue') throw new Mistake('`at_paragraph` is only for continue.')
      const paras = numbered(s.paras)
      const p = paras.find((x) => x.n === intArg(a.at_paragraph))
      if (!p) throw new Mistake(`There is no such paragraph: the scene's paragraphs are [1] to [${paras.length}].`)
      atParagraph = { paragraph: p.n, pid: p.pid, offset: p.to - p.from }
    }
    let length: number | undefined
    if (a.length != null) {
      length = intArg(a.length)
      if (length == null || length < 50 || length > 5000) throw new Mistake('`length` is the words to aim for: 50 to 5,000.')
    }
    const revises = this.revising(a, ['draft'], 'a draft')
    const label = sceneLabelIn(this.outline(), id)
    const why = typeof a.why === 'string' && a.why.trim() ? a.why : direction
    return [
      revises ? `Revising change ${revises.id}` : `Proposing a draft for ${label}`,
      this.propose(
        { kind: 'draft', sceneId: id, sceneLabel: label, mode, direction, ...(beat ? { beat } : {}), ...(atParagraph ? { atParagraph } : {}), ...(length ? { length } : {}), why },
        revises
      )
    ]
  }

  // ---------- STORYTOOLS (chat Phase 3): the story tools, answered in storyTools.ts ----------

  /** What the story tools may use of this answer: the story's point, its names, and proposing. */
  private storyCtx(): StoryCtx {
    return {
      db: this.db,
      storyId: this.place.storyId,
      sceneId: this.place.sceneId,
      later: LATER,
      view: () => this.view(),
      outline: () => this.outline(),
      scene: (n) => this.scene(n),
      chapter: (n) => this.chapter(n),
      sceneLabel: (id) => sceneLabelIn(this.outline(), id),
      sceneHeading: (id) => this.sceneHeading(id),
      proposals: () => this.proposals,
      propose: (p) => this.propose(p),
      mark: (m) => {
        this.mark = { ...this.mark, ...m }
      },
      note: (line) => {
        this.notes.push(line)
      },
      fail: (message) => {
        throw new Mistake(message)
      }
    }
  }

  private answer(name: string, a: Record<string, unknown>): [string, string] {
    const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
    if (name === 'propose_edit' && this.switches.anchor) return this.editAnchored(a)
    if (name === 'propose_rewrite' && this.switches.anchor) return this.rewriteAnchored(a)
    if (name === 'propose_changes' && this.switches.toolChoice) return this.proposeChanges(a)
    if (name === 'ask_user' && this.switches.askUser) return this.askUser(a)
    if (name === 'propose_draft' && this.switches.draft) return this.proposeDraft(a)
    if (this.switches.storyTools) {
      const story = storyAnswer(this.storyCtx(), name, a)
      if (story) return story
    }
    const list = (k: string): string[] | undefined =>
      Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : undefined
    switch (name) {
      case 'read_scene': {
        const id = this.scene(a.scene)
        const s = sceneWords(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const label = this.place.storyId ? sceneLabelIn(this.outline(), id) : `“${s.title}”`
        const heading = this.place.storyId ? this.sceneHeading(id) : label
        const card = repo.getScene(this.db, id).card
        const cardText = [
          card.goal && `Goal: ${card.goal}`,
          card.conflict && `Conflict: ${card.conflict}`,
          card.outcome && `Outcome: ${card.outcome}`,
          card.mood && `Mood: ${card.mood}`,
          card.when && `When: ${card.when}`,
          card.beats.filter((b) => b.trim()).length && `Beats:\n${card.beats.filter((b) => b.trim()).map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
          card.notes && `Notes: ${card.notes}`
        ]
          .filter(Boolean)
          .join('\n')
        this.wordsRead = true
        const wordCount = s.plain.split(/\s+/).filter(Boolean).length
        this.mark = { summary: label, outcome: wordCount ? counted(wordCount, 'word') : 'no words yet' }
        if (this.switches.anchor && s.marked.trim()) {
          // Each paragraph numbered, as propose_edit's `paragraph` and propose_rewrite's `replace_paragraphs` name them.
          const body = s.paras.map((p) => `${p.n ? `[${p.n}] ` : ''}${markedSlice(s, p.from, p.to)}`).join('\n\n')
          const key = `[n] numbers each paragraph${s.marked !== s.plain ? '; *asterisks* mark italics' : ''}`
          return [`Reading ${label}`, `${heading}\n\nScene card:\n${cardText || '(empty)'}\n\nText (${key}):\n${clip(body, SCENE_CHARS)}`]
        }
        const words = s.marked.trim() ? s.marked : '(The scene has no words yet.)'
        return [
          `Reading ${label}`,
          `${heading}\n\nScene card:\n${cardText || '(empty)'}\n\nText${s.marked !== s.plain ? ' (*asterisks* mark italics)' : ''}:\n${clip(words, SCENE_CHARS)}`
        ]
      }
      case 'outline': {
        const o = this.outline()
        // Every card in one query, not one read per scene.
        const cards = repo.sceneCards(this.db, o.scenes.map((s) => s.id))
        const open = this.openIndex()
        const lines = o.chapters.map((c, ci) => {
          const scenes = o.scenes
            .filter((s) => s.chapterId === c.id)
            .map((s, si) => {
              const goal = (cards.get(s.id)?.goal ?? '').trim()
              const at = o.scenes.indexOf(s)
              const mark = s.id === this.place.sceneId ? ` ${OPEN_MARK}` : open >= 0 && at > open ? ' (later)' : ''
              return `  Sc ${si + 1}: ${s.title.trim() || 'Untitled'} (${s.status}, ${s.wordCount} words)${goal ? ` — goal: ${goal}` : ''}${mark}`
            })
          return [`Ch ${ci + 1}: ${c.title.trim() || 'Untitled'}`, ...(scenes.length ? scenes : ['  (no scenes)'])].join('\n')
        })
        const key = open >= 0 && open < o.scenes.length - 1 ? `\n\nScenes marked (later) come after the open scene: the characters don't know their events yet.` : ''
        this.mark = { outcome: `${counted(o.chapters.length, 'chapter')}, ${counted(o.scenes.length, 'scene')}` }
        return ['Looking at the outline', clip(`${o.story.title}\n${lines.join('\n') || '(No chapters yet.)'}${key}`, RESULT_CHARS)]
      }
      case 'search': {
        const q = text('query').trim()
        if (!q) throw new Mistake('Give the words to search for.')
        this.mark.summary = argSummary('search', { query: q })
        return [`Searching for “${q}”`, clip(this.search(q), SHORT_CHARS)]
      }
      case 'get_entry': {
        const found = this.entry(a.name)
        this.mark = {
          summary: found.e.name,
          outcome: found.nameOnly ? 'only its name is known here' : `${KIND_LABELS[found.e.kind].one.toLowerCase()}${found.label ? `, ${found.label}` : ''}`
        }
        return [`Looking up ${found.e.name}`, clip(this.entryText(found), RESULT_CHARS)]
      }
      case 'style_guide': {
        const story = this.place.storyId ? repo.getStory(this.db, this.place.storyId).style : {}
        const s = effectiveStyle(this.place.prefs, repo.getWorldStyle(this.db), story)
        const out = [
          s.pov && `Point of view: ${s.pov}`,
          s.tense && `Tense: ${s.tense}`,
          s.spelling && `Spelling: ${s.spelling}`,
          s.proseStyle && `Prose style: ${s.proseStyle}`,
          s.avoidPhrases.length && `Phrases to avoid: ${s.avoidPhrases.join('; ')}`,
          s.contentLimits && `Limits: ${s.contentLimits}`,
          s.notes && `Notes: ${s.notes}`
        ]
          .filter(Boolean)
          .join('\n')
        this.mark = { outcome: out ? counted(out.split('\n').length, 'rule') : 'empty' }
        return ['Reading the style guide', clip(out || 'The style guide is empty.', SHORT_CHARS)]
      }
      case 'scene_issues': {
        const id = this.scene(a.scene)
        const rows = cdb.sceneIssueRows(this.db, id).filter((r) => r.status === 'open')
        const out = rows.map((r) => `- ${r.message as string}${r.quote ? ` (“${r.quote as string}”)` : ''}`).join('\n')
        this.mark = { summary: this.place.storyId ? sceneLabelIn(this.outline(), id) : '', outcome: rows.length ? counted(rows.length, 'open issue') : 'none open' }
        return ['Checking the scene’s issues', clip(out || 'No open issues in this scene.', SHORT_CHARS)]
      }
      case 'propose_edit': {
        const id = this.scene(a.scene)
        const s = sceneWords(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const asked = text('find')
        if (!asked.trim()) throw new Mistake('`find` is empty. Copy the words to change from the scene.')
        if (asked.includes('\n') || text('replace').includes('\n')) {
          throw new Mistake('Keep each propose_edit inside one paragraph. To rewrite a passage across paragraphs, use propose_rewrite.')
        }
        // The proposal keeps the plain words, which the page looks for when it is applied.
        const hay = s.plain
        const found = locate(s, asked)
        if (found.length === 0) throw new Mistake('Those words are not in the scene as written. Read the scene and copy the words exactly.')
        const [at, atEnd] = found[0]
        const find = hay.slice(at, atEnd)
        if (found.length > 1 || occurrences(hay, find).length > 1) {
          throw new Mistake('Those words occur more than once. Include more of the sentence so they occur only once.')
        }
        // Applying keeps the words' formatting (new words take the italics, or not, of the first old one), so a change
        // into, out of or across italics would lose them. Words all in italics may be replaced as *one run*.
        const flags = s.italic.slice(at, atEnd)
        const italic = flags.every(Boolean)
        const mixed = !italic && flags.some(Boolean)
        let replace = text('replace')
        const marks = /\*[^*\n]+\*/.test(replace)
        if (italic && marks && /^\*[^*\n]+\*$/.test(replace.trim())) replace = replace.replace(/\*/g, '')
        else if (mixed || marks) {
          throw new Mistake(
            "Those words run into, out of or across italics (*…*), which propose_edit can't keep or set. Use propose_rewrite for this instead: its `start` and `end` can be in the same paragraph, and its `replace` keeps *asterisks* as italics."
          )
        }
        if (find === replace) throw new Mistake('The new words are the same as the old.')
        const revisesId = text('revises').replace(/\D/g, '')
        const revises = revisesId ? this.proposals.find((p) => p.id === revisesId) : undefined
        if (revisesId && revises?.kind !== 'text') throw new Mistake(`There is no change ${revisesId} to words to revise.`)
        // Applying one change mustn't lose the words another looks for: overlapping changes (to words or a passage) become one.
        const clash = this.proposals.find((p) => {
          if (p === revises || p.status !== 'pending' || (p.kind !== 'text' && p.kind !== 'passage') || p.sceneId !== id) return false
          const r = rangeOf(p, hay)
          return !!r && r[0] < atEnd && at < r[1]
        })
        if (clash?.kind === 'text') {
          throw new Mistake(
            `Those words overlap change ${clash.id} (“${clip(clash.find, 120)}”): once one is applied, the other's words are gone. Make one change covering both, with \`revises\`: "${clash.id}".`
          )
        }
        if (clash) {
          throw new Mistake(
            `Those words are inside the passage change ${clash.id} rewrites: once one is applied, the other's words are gone. Leave this to that rewrite, or tell the writer it should be folded into it.`
          )
        }
        const label = sceneLabelIn(this.outline(), id)
        return [
          revises ? `Revising change ${revises.id}` : `Proposing an edit to ${label}`,
          this.propose({ kind: 'text', sceneId: id, sceneLabel: label, find, replace, why: text('why') }, revises)
        ]
      }
      case 'propose_rewrite': {
        const id = this.scene(a.scene)
        const s = sceneWords(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const startAsked = text('start').trim()
        const endAsked = text('end').trim()
        const replace = text('replace').trim()
        if (!startAsked || !endAsked) throw new Mistake('Give the passage\'s first words as `start` and its last words as `end`, copied from the scene.')
        if (!replace) throw new Mistake('Give the new passage as `replace`. To cut words, use propose_edit with an empty `replace`.')
        const hay = s.plain
        const starts = locate(s, startAsked)
        if (starts.length === 0) throw new Mistake('The `start` words are not in the scene as written. Read the scene and copy them exactly.')
        const [from, startEnd] = starts[0]
        const start = hay.slice(from, startEnd)
        if (starts.length > 1 || occurrences(hay, start).length > 1) {
          throw new Mistake('The `start` words occur more than once. Give a few more of them so they occur only once.')
        }
        // The end is looked for after the start words, never inside them.
        const ends = locate(s, endAsked, startEnd)
        if (!ends.length) throw new Mistake('The `end` words are not in the scene after the `start` words. Copy the passage\'s last words exactly.')
        const [endAt, to] = ends[0]
        const end = hay.slice(endAt, to)
        // The old passage as read_scene showed it, italics marked, so only real changes show between old and new.
        const original = markedSlice(s, from, to)
        if (original.replace(/\s+/g, ' ') === replace.replace(/\s+/g, ' ')) throw new Mistake('The new passage is the same as the old.')
        const clash = this.proposals.find((p) => {
          if (p.status !== 'pending' || (p.kind !== 'text' && p.kind !== 'passage') || p.sceneId !== id) return false
          const r = rangeOf(p, hay)
          return !!r && r[0] < to && from < r[1]
        })
        if (clash) throw new Mistake(`That passage overlaps change ${clash.id}. Make one change covering both instead.`)
        const label = sceneLabelIn(this.outline(), id)
        return [`Proposing a rewrite of ${label}`, this.propose({ kind: 'passage', sceneId: id, sceneLabel: label, start, end, original, replace, why: text('why') })]
      }
      case 'propose_scene_card': {
        const id = this.scene(a.scene)
        const patch: CardProposal = {}
        for (const k of ['goal', 'conflict', 'outcome', 'mood', 'when', 'notes'] as const) if (typeof a[k] === 'string') patch[k] = text(k).trim()
        const beats = list('beats')
        if (beats) patch.beats = beats
        if (!Object.keys(patch).length) throw new Mistake('Give at least one part of the card to change.')
        const label = sceneLabelIn(this.outline(), id)
        return [`Proposing a change to the card of ${label}`, this.propose({ kind: 'card', sceneId: id, sceneLabel: label, patch, why: text('why') })]
      }
      case 'propose_entry_change': {
        const seen = this.entry(a.name)
        if (seen.nameOnly) throw new Mistake(`${seen.e.name} is ${seen.label}: it can't be changed from this story.`)
        const e = seen.e
        const patch: EntryProposal = {}
        if (typeof a.summary === 'string') patch.summary = text('summary').trim()
        if (typeof a.description === 'string') patch.description = text('description').trim()
        const aliases = list('aliases')
        if (aliases) patch.aliases = aliases
        if (a.fields && typeof a.fields === 'object') {
          const keys = new Set((FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields.map((f) => f.key)))
          const fields: Record<string, string> = {}
          for (const [k, v] of Object.entries(a.fields as Record<string, unknown>)) {
            if (!keys.has(k)) throw new Mistake(`“${k}” isn't one of ${e.name}'s fields. get_entry shows the field keys.`)
            if (typeof v === 'string') fields[k] = v.trim()
          }
          if (Object.keys(fields).length) patch.fields = fields
        }
        if (!Object.keys(patch).length) throw new Mistake('Give at least one part of the entry to change.')
        return [`Proposing a change to ${e.name}`, this.propose({ kind: 'entry', entryId: e.id, entryKind: e.kind, name: e.name, patch, why: text('why') })]
      }
      case 'propose_new_entry': {
        const kind = text('kind') as EntryKind
        if (!ENTRY_KINDS.includes(kind)) throw new Mistake(`Kind must be one of: ${ENTRY_KINDS.join(', ')}.`)
        const name = squash(text('name'))
        if (!name) throw new Mistake('Give the new entry a name.')
        if (repo.listEntries(this.db).some((e) => lower(e.name) === lower(name))) {
          throw new Mistake(`There is already an entry called “${name}”. Propose a change to it instead.`)
        }
        return [
          `Proposing a new ${KIND_LABELS[kind].one.toLowerCase()}`,
          this.propose({ kind: 'newEntry', entryKind: kind, name, summary: text('summary').trim(), description: text('description').trim(), why: text('why') })
        ]
      }
      case 'propose_new_scene': {
        const chapterId = this.chapter(a.chapter)
        const o = this.outline()
        const ci = o.chapters.findIndex((c) => c.id === chapterId)
        const title = squash(text('title'))
        if (!title) throw new Mistake('Give the new scene a title.')
        const card: CardProposal = {}
        if (text('goal').trim()) card.goal = text('goal').trim()
        const beats = list('beats')
        if (beats?.length) card.beats = beats
        const chapterLabel = `Ch ${ci + 1}${o.chapters[ci].title.trim() ? ` “${o.chapters[ci].title.trim()}”` : ''}`
        return [`Proposing a new scene in ${chapterLabel}`, this.propose({ kind: 'newScene', chapterId, chapterLabel, title, card, why: text('why') })]
      }
      case 'propose_new_chapter': {
        if (!this.place.storyId) throw new Mistake('No story is open.')
        const title = squash(text('title'))
        if (!title) throw new Mistake('Give the new chapter a title.')
        return ['Proposing a new chapter', this.propose({ kind: 'newChapter', storyId: this.place.storyId, title, why: text('why') })]
      }
      case 'propose_rename': {
        const to = squash(text('to'))
        if (!to) throw new Mistake('Give the new title.')
        if (text('chapter').trim()) {
          const id = this.chapter(a.chapter)
          const from = this.outline().chapters.find((c) => c.id === id)!.title
          return ['Proposing a new title', this.propose({ kind: 'rename', target: 'chapter', targetId: id, from, to, why: text('why') })]
        }
        const id = this.scene(a.scene)
        const from = this.outline().scenes.find((s) => s.id === id)?.title ?? ''
        return ['Proposing a new title', this.propose({ kind: 'rename', target: 'scene', targetId: id, from, to, why: text('why') })]
      }
      default:
        throw new Mistake(`There is no tool called “${name}”.`)
    }
  }

  /** Answers a model turn's calls, in order: the tool messages to send back, and the steps for "What the AI saw". */
  async runAll(calls: ToolCall[], step?: number): Promise<{ results: ChatMessage[]; steps: ToolActivity[] }> {
    // The calls as they were shown starting, in their order in the request (a call's id may only come later, so each
    // is matched by its place); one that never came whole ends as not run.
    const begun = [...this.started.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
    this.started = new Map()
    const results: ChatMessage[] = []
    const steps: ToolActivity[] = []
    for (const [i, c] of calls.entries()) {
      const { result, step: done } = this.run(c, begun[i] ?? this.begin(c.name, step ?? null))
      results.push({ role: 'tool', toolCallId: c.id, content: result })
      steps.push(done)
    }
    for (const left of begun.slice(calls.length)) this.onTool?.('end', { ...left, status: 'stopped', endedAt: Date.now() })
    return { results, steps }
  }
}
