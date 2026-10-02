// Codex and entry pages (milestone 3). Owned by the Entry views part.
// See docs/ARCHITECTURE.md, "Milestone 3".
import type { ChangeView, Entry, EntryKind, ExistsKind, ExistsPoint, ID, Origin } from '../types'

export interface EntryViewsApi {
  /**
   * Every entry as a codex card: its portrait, one-liner and tags, with how often and where it last
   * appears (for sorting by importance or last appearance) and the stories it belongs to (for the
   * story filter). Quick in a big world: each scene's words are read once and remembered until they change.
   */
  listCodex(): Promise<CodexCard[]>
  /**
   * Every scene an entry appears in, in reading order: scenes whose card has it as point of view,
   * present or the location, scenes whose words name it or an alias (the memory keeper's rule for
   * names), and scenes its changes are pinned to.
   */
  listAppearances(entryId: ID): Promise<Appearance[]>
  /** Where an entry first exists, each point in plain words with the story it belongs to. */
  listFirstExists(entryId: ID): Promise<FirstExists[]>
  /**
   * Replaces where an entry first exists (spec, Multi-story rules: shown and changed only on the
   * entry page and in the story questions). Points Adam adds or changes carry `byHand: true`, so
   * they are never worked out again; Undo sends the earlier list back as it was. At least one point.
   */
  setFirstExists(entryId: ID, points: FirstExistsInput[]): Promise<FirstExists[]>
  /**
   * "Only from <story> on": Adam edited the profile while working in a story other than the one
   * where the entry first exists. The fields he changed (compared with `before`) become a
   * start-of-story change for that story (an update change, origin 'adam'), and the profile goes
   * back to `before`, with who each of those fields came from. Returns the entry as it is now and
   * the new change.
   */
  keepEditFromStory(entryId: ID, storyId: ID, before: ProfileBefore): Promise<{ entry: Entry; change: ChangeView }>
}

export interface EntryViewsEvents {}

/** One entry as the codex shows it. Like every list, it carries only the portrait's address. */
export interface CodexCard {
  id: ID
  kind: EntryKind
  name: string
  /** Other names, for searching the codex. */
  aliases: string[]
  /** The one-liner. */
  summary: string
  tags: string[]
  /** Its portrait's address (see Entry.image), or null. */
  image: string | null
  /** A character's role in the story ('protagonist', 'antagonist', 'supporting', 'minor' or Adam's own words); '' when not set. */
  role: string
  hardRule: boolean
  /** How many scenes it appears in. */
  scenes: number
  /** For sorting by importance: scenes from its point of view count most, then being in a scene or its setting, then being named or changed. */
  importance: number
  /** Where it last appears in reading order (`order` sorts across stories); null when it appears in no scene yet. */
  last: { sceneId: ID; storyId: ID; label: string; order: number } | null
  /** Stories it appears in or first exists in (the beginning of the world counts as the world's first story). */
  storyIds: ID[]
}

/** How an entry is in a scene: its point of view, present, the location, named in the words, or changed there. */
export type AppearanceHow = 'pov' | 'present' | 'location' | 'named' | 'changes'

/** One scene an entry appears in. */
export interface Appearance {
  sceneId: ID
  storyId: ID
  /** Plain words: "Book 1, Ch 12, Sc 3". */
  label: string
  /** The scene's own title ('' when it has none). */
  title: string
  how: AppearanceHow[]
  /** The words around its first mention, cut from the scene's text exactly (so the scene can open at them); null when it isn't named there. */
  quote: string | null
}

/** A first-exists point with its place in plain words. */
export interface FirstExists extends ExistsPoint {
  /** "the beginning of the world", "the start of Book 2", "Book 1, Ch 3, Sc 2". */
  label: string
  /** The story it belongs to: the point's story (a scene's story), or the world's first story for the beginning of the world. Null when there is none. */
  homeStoryId: ID | null
}

export interface FirstExistsInput {
  kind: ExistsKind
  storyId: ID | null
  sceneId: ID | null
  byHand: boolean
}

/** The profile fields an edit changed, as they were before it, for "Only from <story> on". */
export interface ProfileBefore {
  summary?: string
  description?: string
  /** Only the fields the edit changed. */
  fields?: Record<string, string>
  /** Who each of those came from before the edit (keys as in Entry.fieldOrigins); null where it followed the entry's own origin. */
  origins: Record<string, Origin | null>
}
