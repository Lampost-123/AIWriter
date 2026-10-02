// Inside the manuscript: name underlines, hover cards, the entry side panel, the Cast tab and Add to memory (milestone 3). Owned by the Manuscript part.
// See docs/ARCHITECTURE.md, "Milestone 3".
import type { EntryKind, ID, RelationshipState } from '../types'

export interface ManuscriptApi {
  /**
   * What the page and the scene panel need about a scene's people, places and things, in one call
   * (never one per hover): every entry's names, for the underlines, and as of the end of this scene
   * (its own changes included) each one's one-liner, portrait, state and voice notes, for the hover
   * cards, the Cast tab and the entry beside the page; who the scene card says is in the scene; and
   * the relationships as of the scene.
   */
  getSceneNames(sceneId: ID): Promise<SceneNames>
}

export interface ManuscriptEvents {}

/** One line of an entry's state as of a scene: something that happened to it, or a field a change set. */
export interface StateLine {
  /** Something that happened to it, or a field a change set (what is true now). */
  kind: 'happened' | 'field'
  /** "Lost her left hand", or "Hair: cropped short". */
  text: string
  /** Where it happened in plain words ("Book 1, Ch 2, Sc 3"); '' for a field, or for what was so before any story. */
  where: string
  /** It happened in this scene. */
  here: boolean
}

/** How a character speaks, from the Voice fields (as of the scene). */
export interface VoiceNotes {
  speech: string
  tics: string
  neverSays: string
  /** Sample lines of dialogue, one each, in Adam's order. */
  sampleLines: string[]
}

/** An entry as the page and the scene panel show it at one scene. */
export interface NamedEntry {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
  /** Its one-liner as of the scene. */
  summary: string
  /** Its portrait's address, or null (see Entry.image). */
  image: string | null
  /** Why it isn't in the story at this point ("Not in the story yet at this point"), or null when it is. */
  absent: string | null
  /** What has happened to it so far (oldest first, the last few), then the fields changes have set. */
  state: StateLine[]
  /** For a character with voice notes. */
  voice: VoiceNotes | null
}

export interface SceneNames {
  sceneId: ID
  storyId: ID
  /** The scene in plain words: "Book 1, Ch 12, Sc 3". */
  label: string
  /** Every live entry (plot threads too, though their names aren't underlined). */
  entries: NamedEntry[]
  /** Who the scene card says is in the scene (live entries only). */
  cast: { povId: ID | null; presentIds: ID[]; locationId: ID | null }
  /** Every relationship as of the scene, for the entry beside the page. */
  relationships: RelationshipState[]
}
