// Timeline, relationship map and plot threads board (milestone 3). Owned by the World views part.
// See docs/ARCHITECTURE.md, "Milestone 3".
//
// Each view is worked out in the main process for one story at a time, with the same line as drafting
// (spec, Multi-story rules: "every as-of view uses it too"), and comes back in one call with everything
// its screen needs. Places are in plain words ("Book 1, Ch 3, Sc 2").

import type { AsOf, AsOfStop, EntryKind, ID } from '../types'

export interface WorldViewsApi {
  /**
   * The timeline of a story: its scenes, and the events that exist by its end, along the in-world
   * calendar (read from each When box; scenes whose date can't be read keep their reading order), with
   * who is in each and the clashes between them. Covers every story the story follows on from, and the
   * side stories it knows of.
   */
  getTimeline(storyId: ID): Promise<Timeline>
  /**
   * The relationship map as seen in a story, as of a point on its as-of slider. With no point, the scene
   * `sceneId` (the one Adam is in) if it is on the slider, otherwise the story's end.
   */
  getRelationshipMap(storyId: ID, at: AsOf | null, sceneId?: ID | null): Promise<RelationshipMap>
  /** The plot threads board as seen in a story, at its end: open, resolved and planned threads, with where each was set up and paid off. */
  getThreadsBoard(storyId: ID): Promise<ThreadsBoard>
}

export interface WorldViewsEvents {}

// ---------- Timeline ----------

/** One scene or event on the timeline. */
export interface TimelinePoint {
  kind: 'scene' | 'event'
  /** The scene's id, or the event's entry id. */
  id: ID
  /** The story a scene is in; null for an event. */
  storyId: ID | null
  /** Where a scene is, in plain words ("Book 1, Ch 3, Sc 2"); '' for an event. */
  place: string
  /** The scene's title, or the event's name. */
  title: string
  /** Adam's own words from the When box (or the event's When field); '' when it is empty. */
  when: string
  /**
   * False when the When text can't be read as a date: the point keeps its reading order and shows "No date".
   * A date in a calendar of Adam's own ("the 3rd of Frostmoon") is dated but also keeps its reading order.
   */
  dated: boolean
  /** Points on the same in-world day share this value; null when no day is named. */
  day: string | null
  /** The point-of-view character (scenes only). */
  povId: ID | null
  /** Characters present (with the point of view), or for an event the characters involved in it. */
  presentIds: ID[]
  locationId: ID | null
  /** Plot threads it sets up or pays off: the scene card's, and where the memory has a thread open or resolved. */
  setsUpIds: ID[]
  paysOffIds: ID[]
  /** The clashes this point is part of (indexes into Timeline.clashes). */
  clashes: number[]
}

/** A character in two places on the same in-world day. */
export interface TimelineClash {
  characterId: ID
  /** The scenes involved, in timeline order. */
  sceneIds: ID[]
  /** "Mara is in Ashford and the Mill on Day 12." */
  text: string
}

/** A character, place or plot thread the points refer to. */
export interface TimelineEntry {
  id: ID
  kind: EntryKind
  name: string
  /** Its portrait's address, when it has one. */
  image: string | null
}

export interface Timeline {
  storyId: ID
  /** In in-world order. */
  points: TimelinePoint[]
  entries: TimelineEntry[]
  clashes: TimelineClash[]
}

// ---------- Relationship map ----------

/**
 * The least distance between two characters on the map, in map units (one unit is one pixel at life
 * size): the layout keeps them this far apart, and the map never draws a portrait wider than this at
 * any zoom, so portraits never cover each other.
 */
export const MAP_GAP = 96

/** A character on the map, at its place in the layout (which stays put as the slider moves). */
export interface MapNode {
  id: ID
  name: string
  image: string | null
  x: number
  y: number
}

/** A relationship between two characters at the point. */
export interface MapLink {
  aId: ID
  bId: ID
  /** Plain words: "sister", "rival", "owes money". */
  type: string
  /** How a feels about b, and b about a. */
  aFeels: string
  bFeels: string
  /** Where it last changed, in plain words; '' when it was set before any story. */
  where: string
}

/** A group someone belongs to somewhere on the story's slider. */
export interface MapGroup {
  id: ID
  name: string
  /** Who belongs to it at the point (nobody yet is possible). */
  memberIds: ID[]
  /** Everyone who belongs to it anywhere on the story's slider: the map fits them all when the group is picked. */
  allMemberIds: ID[]
  /** Whether anyone has belonged to it by the point: when nobody belongs now, they have left. */
  hadMembers: boolean
  /** Whether someone joins it later on the slider than the point. */
  joinsLater: boolean
}

/** Where a character sits on the map. */
export interface MapPlace {
  id: ID
  x: number
  y: number
}

export interface RelationshipMap {
  storyId: ID
  /** The point shown (one of `stops`). */
  at: AsOf
  /** The point in plain words: "Book 1, Ch 12, Sc 3". */
  label: string
  /** The slider's stops; `changes` counts the relationships between characters that change there. */
  stops: AsOfStop[]
  /** Characters with a relationship to another character, or in a group, at the point. */
  nodes: MapNode[]
  links: MapLink[]
  /** Groups someone belongs to anywhere on the story's slider, by name, so the group filter stays the same as the slider moves. */
  groups: MapGroup[]
  /**
   * Every character the map can show anywhere on the story's slider, where each sits: the map is fitted
   * to them all, so nobody appears outside the window as the slider moves.
   */
  everyone: MapPlace[]
  /** Whether characters have any relationship anywhere along the story (otherwise the map explains where they come from). */
  any: boolean
}

// ---------- Plot threads board ----------

/** Where a thread was set up or paid off. */
export interface BoardPlace {
  /** "Book 1, Ch 3, Sc 2", "the start of Book 2", or '' for before any story. */
  label: string
  storyId: ID | null
  /** The scene to open, when it is a scene. */
  sceneId: ID | null
  /** Only on a scene card so far: the memory hasn't seen it happen in the text yet. */
  planned: boolean
}

export interface BoardThread {
  id: ID
  name: string
  /** What's promised to the reader (the thread's `promise` field). */
  promise: string
  /** 'planned': set up on scene cards (or nowhere yet) but not yet opened in the story. */
  column: 'open' | 'resolved' | 'planned'
  setUp: BoardPlace | null
  paidOff: BoardPlace | null
  /** While open: how many chapters have gone by since it was set up. */
  openChapters: number | null
  /** Open for many chapters: highlighted so it isn't forgotten. */
  longOpen: boolean
  /** The memory found it in the text (2026-10-08): Adam never made or edited it. Left out by older boards. */
  aiMade?: boolean
  /**
   * While resolved: the words of the payoff (from the scene, '' when it was marked by hand), whether the memory read
   * it, and the "What changed" line Undo takes back (only for the memory's own resolve, while it can be undone).
   */
  resolved?: { quote: string; byAi: boolean; undoId: ID | null } | null
  /**
   * The open threads ledger (World Memory Overhaul B4): the scene on the story's line that last touched it (a thread
   * change, a clue or words its facts rest on), null when nothing did; and, while open, how many scenes it has been
   * quiet since, to the story's end (null when not open or never touched). Left out by older boards.
   */
  lastTouched?: BoardPlace | null
  quietScenes?: number | null
}

/**
 * Quiet for this many scenes or more: the ledger marks an open thread as quiet, and (when it was last touched in the
 * story being written) the writer gets a gentle reminder of it (World Memory Overhaul B4).
 */
export const QUIET_SCENES = 6

export interface ThreadsBoard {
  storyId: ID
  /** Ordered by where they were set up. */
  threads: BoardThread[]
}
