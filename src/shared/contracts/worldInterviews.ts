// Interviews by topic (Adam, 2026-10-20): instead of one broad interview, the AI asks about one part of the world at a
// time, a few short questions a round: 1. Characters, 2. Places, 3. Lore and history, then 4. How it all connects,
// which fills in the links between what was kept (who lives or works where, who knows which lore, which history shaped
// whom, how the characters stand with each other). Each ends in suggested codex pages (or, for the connections, links
// and additions to pages) that Adam keeps, changes or discards; nothing goes into the world without a click, and each
// Keep has Undo (undoWorldBuild with its run). The same interviews are in Build with AI's Cast and world (a story) and
// on the World builder page (a world on its own). The questions and answers live in the window while the app is open;
// what was kept is in the world (one memory run per Keep, its line marked as from an interview), so the topics stay
// marked done. See docs/ARCHITECTURE.md, "Interviews by topic".

import type { EntryKind, ID } from '../types'

/** The four interviews, in the order they are offered (any order works). */
export type InterviewTopic = 'characters' | 'places' | 'lore' | 'connections'

export const INTERVIEW_TOPICS: InterviewTopic[] = ['characters', 'places', 'lore', 'connections']

/** The kind of page each topic suggests (the connections suggest links, not pages). */
export const TOPIC_KIND: Record<Exclude<InterviewTopic, 'connections'>, EntryKind> = {
  characters: 'character',
  places: 'place',
  lore: 'lore'
}

/** The parts a suggested page of each kind may fill (their keys in shared/fields.ts), most useful first. */
export const TOPIC_FIELDS: Partial<Record<EntryKind, string[]>> = {
  character: ['role', 'traits', 'wants', 'fears', 'secrets', 'origin', 'speech', 'clothing'],
  place: ['atmosphere', 'senses', 'geography', 'people', 'history'],
  lore: ['category', 'rules', 'limits']
}

/** One question of an interview and what Adam said: his answer in his own words, or skipped. */
export interface TopicAsked {
  question: string
  answer: string
  skipped: boolean
}

/** How an AI call that waits for its whole answer ended. `error` is in plain words. */
interface Ended {
  status: 'complete' | 'stopped' | 'error'
  generationId: ID | null
  error: string | null
}

/** Where an interview is: a story (Build with AI) or the world on its own (storyId null: the World builder page). */
export interface InterviewWhere {
  storyId: ID | null
}

export interface TopicQuestionsRequest extends InterviewWhere {
  taskId: ID
  topic: InterviewTopic
  asked: TopicAsked[]
}

/** The next few questions, or `enough` when the AI has what it needs to suggest (questions then empty). */
export interface TopicQuestions extends Ended {
  questions: string[]
  enough: boolean
}

/** A codex page the AI suggests from a topic's answers: a new page, or what an existing page is missing. */
export interface TopicEntry {
  /** Stable while the suggestions are on screen. */
  key: string
  kind: EntryKind
  name: string
  aliases: string[]
  /** One line. */
  summary: string
  /** Kind-specific fields by their keys in shared/fields.ts (only those with words). */
  fields: Record<string, string>
  /** A place: the place it is inside, by name ('' for none). */
  in: string
  /** Lore: always so, a rule never to break. */
  rule: boolean
  /** The page the world has already under this name: Keep fills only its empty parts. */
  existing: { entryId: ID; name: string } | null
  /** The parts in Adam's own words (from his answers, or changed by him): kept as his. */
  his: string[]
}

/** A link the connections interview suggests between two pages, or something to add to one page. */
export interface TopicLink {
  key: string
  /**
   * 'relationship': how two pages stand ("sister of", "lives at", "knows about", "shaped by"), on the first;
   * 'inside': a place inside another (a room in a house); 'detail': words for an empty part of one page.
   */
  link: 'relationship' | 'inside' | 'detail'
  from: { entryId: ID; name: string; kind: EntryKind }
  /** The other page (null for a detail). */
  to: { entryId: ID; name: string; kind: EntryKind } | null
  /** A relationship's type, in a few words ("older sister", "works at"). */
  type: string
  /** A relationship between characters: how the first feels about the other, and the other back ('' for unsaid). */
  feels: string
  otherFeels: string
  /** A detail: the field it fills (shared/fields.ts) and its words. */
  field: string
  text: string
  /** Why, in one short line from the answers (shown under it). */
  why: string
}

export interface TopicSuggestRequest extends InterviewWhere {
  taskId: ID
  topic: InterviewTopic
  asked: TopicAsked[]
}

export interface TopicSuggestions extends Ended {
  entries: TopicEntry[]
  links: TopicLink[]
}

/** Keep: one suggested page (`entry`) or link (`link`), as it is on screen (with Adam's changes). */
export interface TopicKeepRequest extends InterviewWhere {
  topic: InterviewTopic
  entry?: TopicEntry
  link?: TopicLink
}

/** What Keep made: Undo is undoWorldBuild(runId); its Undo again is redoWorldBuild(runId, lineIds). */
export interface TopicKept {
  runId: ID
  entryId: ID | null
  /** The page's name, for the toast. */
  name: string
}

/** How many pages and links each topic has kept here (not undone, not deleted since). */
export type InterviewProgress = Record<InterviewTopic, number>

export interface WorldInterviewsApi {
  /** The next few questions of a topic's interview. Stop is stopTask(taskId). */
  askTopicQuestions(input: TopicQuestionsRequest): Promise<TopicQuestions>
  /** The pages (or, for the connections, the links) a topic's answers suggest. Nothing is made. Stop is stopTask(taskId). */
  suggestFromTopic(input: TopicSuggestRequest): Promise<TopicSuggestions>
  /** Keeps one suggestion: the page made (or filled in), or the link made, as one line in What changed. */
  keepTopicSuggestion(input: TopicKeepRequest): Promise<TopicKept>
  /** What each topic has kept here, so the topics show which are done. */
  getInterviewProgress(where: InterviewWhere): Promise<InterviewProgress>
}
