// The start screen (spec, "Visual design and UX › Start screen"): every world in the library with its stories,
// where Adam left off, renaming worlds and stories in place (open or not), and deleting a whole world into the
// library's Recently deleted folder for 30 days. Owned by the Start screen part.
//
// No data model change: the list is read from the library folder and each world's world.db (read-only, never a
// scene's text: word counts come from scenes.word_count). A deleted world's folder (world.db, history.db, images/,
// backups/) is moved whole into `<library>/Recently deleted/`, with a small `deleted.json` beside it saying what it
// was, and is removed for good after 30 days or by "Empty now".

import type { ID, WorldSummary } from '../types'

/** The name of the folder inside the library that holds deleted worlds. listWorlds() never lists it. */
export const DELETED_WORLDS_FOLDER = 'Recently deleted'

/** How long a deleted world is kept before it is removed for good. */
export const DELETED_WORLD_DAYS = 30

export interface LibraryStory {
  id: ID
  title: string
  /** What it is, in a few words, as the story menu says it ("Book 2", "Prequel to Book 1", "Side story during Book 2"); '' with nothing to say. */
  kind: string
  /** Its live scenes' words. */
  words: number
  /** When it or any of its scenes last changed (ISO); '' when unknown. */
  editedAt: string
}

export interface LibraryWorld {
  id: ID
  name: string
  folder: string
  /** Its live stories, in reading order. */
  stories: LibraryStory[]
  /** Words across its live stories. */
  words: number
  /** When Adam last had it open (Settings.worldsSeenAt), else when it last changed (ISO); '' when unknown. */
  openedAt: string
  /** The world's own "last changed" time (meta updated_at). */
  updatedAt: string
  /** It is the sample world (Gullhaven). */
  sample: boolean
}

/** A world in Recently deleted. */
export interface DeletedWorld {
  /** Its folder's name inside Recently deleted (what restore and empty take). */
  trashId: string
  worldId: ID
  name: string
  stories: number
  words: number
  /** When it was deleted (ISO). */
  deletedAt: string
  /** When it goes for good (ISO): deletedAt + 30 days. */
  purgeAt: string
}

/** Where Adam left off: the last world, story and scene, for the Continue card. */
export interface LastPlace {
  worldId: ID
  worldName: string
  storyId: ID | null
  storyTitle: string
  sceneId: ID | null
  sceneTitle: string
  /** When he was last there (ISO); '' when unknown. */
  at: string
}

export interface LibraryOverview {
  /** False when the library folder can't be reached (a drive not plugged in): worlds and deleted are then empty. */
  reachable: boolean
  libraryPath: string
  /** Newest opened first. */
  worlds: LibraryWorld[]
  /** Newest deleted first. */
  deleted: DeletedWorld[]
  /** Null when there is nowhere to go back to (no last world, or it has gone). */
  last: LastPlace | null
}

/** Calls the interface can make. */
export interface LibraryApi {
  /** Every world with its stories, what is in Recently deleted, and where Adam left off. Removes deleted worlds past 30 days first. */
  getLibrary(): Promise<LibraryOverview>
  /**
   * True once per run of the app, on the first call, when the start screen should show at launch: the setting
   * "When AI Write opens" is the start screen (the default) and AIWRITE_START isn't 'off' (app tests). A reload
   * of the window is not a launch, so it answers false then.
   */
  startScreenAtLaunch(): Promise<boolean>
  /** Renames any world (the open one or not); only its name inside the world, never its folder. */
  renameWorldIn(worldId: ID, name: string): Promise<void>
  /** Renames a story in any world (the open one or not). */
  renameStoryIn(worldId: ID, storyId: ID, title: string): Promise<void>
  /**
   * Moves a world's whole folder into Recently deleted. The open world is closed first (the interface stops any
   * draft and saves before asking). Refused in plain words if the folder can't be moved (in use by another program).
   */
  deleteWorld(worldId: ID): Promise<DeletedWorld>
  /** Moves a deleted world back into the library (under a free folder name) and returns it. */
  restoreWorld(trashId: string): Promise<WorldSummary>
  /** Removes deleted worlds for good: one (trashId), or all of them ("Empty now"). */
  emptyDeletedWorlds(trashId?: string): Promise<void>
}

/** Events from the main process. */
export interface LibraryEvents {}
