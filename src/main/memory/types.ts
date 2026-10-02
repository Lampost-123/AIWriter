// The memory engine's contract. Three parts build against it:
//   line.ts   the line: which stories, chapters and scenes come before a point, in order
//             (the spec's "Multi-story rules" tab). Pure, over a WorldShape.
//   state.ts  what is true at a point: each entry's state, relationships, who knows what,
//             plot threads, which entries exist. Pure, over MemoryData and a Line.
//   scene.ts  reads the open world's database and returns a SceneMemory for a scene: what the
//             briefing (src/main/ai/context.ts) and the memory keeper are given.
// Every question about "what came earlier" goes through buildLine, including the previous scene.

import type {
  Answer,
  Change,
  Entry,
  EntryState,
  ExistsPoint,
  FactState,
  ID,
  RelationshipState,
  StartAt,
  EndAt,
  StoryKind,
  Summary,
  ThreadState
} from '@shared/types'

// ---------- The shape of a world's stories (no text) ----------

export interface SceneNode {
  id: ID
  title: string
}

export interface ChapterNode {
  id: ID
  title: string
  /** Live scenes, in order. */
  scenes: SceneNode[]
}

export interface StoryNode {
  id: ID
  title: string
  kind: StoryKind
  seriesId: ID | null
  startStoryId: ID | null
  startAt: StartAt
  startRefId: ID | null
  endAt: EndAt | null
  endRefId: ID | null
  leadsIntoId: ID | null
  leadsIn: boolean
  /** Shelf order: display only, never decides what counts. */
  position: number
  /** Creation order: breaks ties. */
  createdOrder: number
  /** Live chapters, in order. */
  chapters: ChapterNode[]
}

export interface WorldShape {
  stories: StoryNode[]
  /** Adam's answers (side story order and the rest). */
  answers: Answer[]
}

// ---------- The line ----------

/** What a line is built up to. */
export type LineTarget =
  /** Just before this scene (what counts for drafting it). */
  | { storyId: ID; before: ID }
  /** The whole story, start-of-story changes and every scene (what later stories see of it). */
  | { storyId: ID; through: 'end' }
  /** The story's start, after its start-of-story changes and before its first scene. */
  | { storyId: ID; through: 'start' }

/**
 * One step of the walk, in order. `via` says how the step's story got onto the walk:
 * 'line' for the chain of stories the target follows on from (and the target itself),
 * 'side' for a side story added whole when the walk reached its end point.
 */
export type LineStep =
  /** A story's start, before its start-of-story changes ('story-pre' exists points sit here). */
  | { type: 'start'; storyId: ID; via: 'line' | 'side' }
  /** Its start-of-story changes apply here ('story-post' exists points sit just after). */
  | { type: 'start-changes'; storyId: ID; via: 'line' | 'side' }
  /** A scene: the changes pinned to it apply here. */
  | { type: 'scene'; storyId: ID; chapterId: ID; sceneId: ID; via: 'line' | 'side' }
  /** The walk passed the end of a chapter. */
  | { type: 'chapter-end'; storyId: ID; chapterId: ID; via: 'line' | 'side' }
  /** The walk reached a story's end. */
  | { type: 'end'; storyId: ID; via: 'line' | 'side' }

/** How far the walk went into one story. */
export interface LineSegment {
  storyId: ID
  via: 'line' | 'side'
  /** For a side story: the story whose walk added it. */
  addedIn: ID | null
  /** True when every scene of the story is on the walk: the walk reached the story's end. */
  whole: boolean
  /** Where the walk stopped in this story when not whole: its start (before or after its start-of-story changes), after a chapter or after a scene. */
  stop: { at: StartAt; refId: ID | null } | null
}

export interface Line {
  target: LineTarget
  /** Every step before the target, in order. */
  steps: LineStep[]
  /** Each story the walk went into, in walk order (the target story last). */
  segments: LineSegment[]
}

// ---------- What is true at a point ----------

/**
 * A first-exists point as the memory reads it. A point at a scene that is deleted (its story isn't)
 * has `after`: it counts just after the place before that scene (the scene before it, the end of the
 * chapter before, or the story's start after its start-of-story changes), as a story that started
 * after that scene would. So deleting the scene where a character first appeared doesn't make them
 * vanish from every later scene.
 */
export type ExistsAt = ExistsPoint & { after?: { at: 'post' | 'chapter' | 'scene'; refId: ID | null } }

export interface MemoryData {
  /** Every live entry (baselines). */
  entries: Entry[]
  /** Every live change. */
  changes: Change[]
  exists: ExistsAt[]
  answers: Answer[]
}

export interface MemoryState {
  /** Every entry that exists at this point, as of this point. */
  entries: Map<ID, EntryState>
  /** Entries whose first-exists point is the target scene itself ("first appears in this scene"). */
  firstHere: Set<ID>
  relationships: RelationshipState[]
  facts: FactState[]
  threads: ThreadState[]
}

// ---------- What a scene's briefing and the memory keeper are given ----------

export interface StorySoFar {
  /** This story's scene summaries before this scene, oldest first. */
  scenes: { sceneId: ID; chapterId: ID; label: string; text: string }[]
  /** This story's chapters that ended before this scene, oldest first, with their summaries. */
  chapters: { chapterId: ID; label: string; text: string }[]
  /**
   * One paragraph for each earlier story on the walk, oldest first. Side stories are marked
   * meanwhile. A story the line cuts short is summarised from its chapter summaries up to the cut
   * (or its scene summaries when the cut falls inside a chapter); its whole-story summary is never used.
   */
  stories: { storyId: ID; title: string; meanwhile: boolean; cut: boolean; text: string }[]
  /** Series roll-ups, for when space is tight: each only if every story it covers is fully on the walk. */
  series: { seriesId: ID; name: string; storyIds: ID[]; text: string }[]
  /** For the story that leads into a book: that book's opening summary and how the cast must be when it begins. */
  leadsInto: { storyId: ID; title: string; text: string } | null
}

export interface SceneMemory {
  storyId: ID
  sceneId: ID
  /** "This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5." */
  knows: string
  /** Block 3: the last scene on the line before this one (never a side story added whole). */
  previous: { sceneId: ID; title: string; text: string } | null
  /** Every entry that exists here, as of this scene. */
  entries: EntryState[]
  /** Ids of entries whose first appearance is this scene. */
  firstHere: ID[]
  /**
   * Entries that don't exist at this point, with the label to send if Adam pins or lists one:
   * "not in the story yet at this point", "from Kell's Road, not in this story so far".
   */
  elsewhere: { entry: EntryState; label: string }[]
  relationships: RelationshipState[]
  facts: FactState[]
  threads: ThreadState[]
  storySoFar: StorySoFar
  /** Changes pinned to this scene: never facts for drafting it; on a redraft the card shows them as "what this scene should bring about". */
  bringAbout: Change[]
}

/** Summaries the story-so-far is built from, by level and target id. */
export type SummaryIndex = Map<string, Summary>
export const summaryKey = (level: Summary['level'], targetId: ID): string => `${level}:${targetId}`
