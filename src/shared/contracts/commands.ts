// Under suggestion (the story map, phase 2, Adam 2026-10-24): the hypnotic suggestions and commands people in a story are
// under, read from the scenes by the memory model and kept with a history, scene by scene. Each command belongs to the
// person under it; each step of its history (given, made stronger, changed, fired, resisted, ended) is tied to the scene
// it happens in, so what holds is worked out as of any scene, as every memory fact is (src/main/memory/commands.ts).
// Commands stack: one never silently replaces another; one that covers all clothes covers the others while it holds.
// A command with a trigger is planted and waits: it changes nothing until the trigger happens in a scene.
// Main side: src/main/commands/ (reading, briefing lines), src/main/db/commands.ts (SQL).
import type { ID } from '../types'

/** What sort of thing a command changes, so clothing ones can stack into what someone wears. */
export type CommandKind = 'clothing' | 'feeling' | 'action' | 'forget' | 'other'

/** Who can set off a command's trigger. */
export type TriggerBy = 'anyone' | 'giver'

/** How long a command's effect lasts once it is in force: until the story ends it, or only for the scene it starts in. */
export type CommandLasts = 'story' | 'scene'

/** A command's details. A step that changes it gives only what changes. */
export interface CommandValues {
  /** What was said, in short ("You won't wear socks any more"). */
  words: string
  /** What it makes them do, in plain words ("wears no socks"). */
  does: string
  kind: CommandKind
  /** For clothing: the pieces it keeps off them ("socks", "bra"). */
  off: string[]
  /** For clothing: it keeps every piece off ("be naked"); it covers the others while it holds. */
  all: boolean
  /** What sets it off ("hears the word 'banana'"); '' when it holds as soon as it is given. */
  trigger: string
  triggerBy: TriggerBy
  /** Once fired, a trigger is used up ('once') or waits again for next time ('every'). */
  every: boolean
  lasts: CommandLasts
  /** How it feels to them ("feels like her own idea"). */
  feels: string
}

export type CommandStepKind = 'given' | 'stronger' | 'changed' | 'fired' | 'resisted' | 'ended'

/** One step of a command's history, as stored. */
export interface CommandStep {
  id: ID
  commandId: ID
  sceneId: ID
  kind: CommandStepKind
  /** What this step sets (all of it for 'given'; only what changes for 'stronger' and 'changed'; nothing otherwise). */
  values: Partial<CommandValues>
  /** The scene's own words it was read from. */
  quote: string
  /** Adam's own words for a change he made. */
  note: string
  origin: 'ai' | 'adam'
  /**
   * Adam's answer to a step the memory read: '' not asked or not answered, 'yes' he said it's right, 'no' it isn't (kept
   * hidden, so reading the scene again doesn't bring it back). A step the memory wasn't sure of counts only once he says yes.
   */
  answer: '' | 'yes' | 'no'
  /** The memory model wasn't sure the scene says this. */
  unsure: boolean
  /** Order among the steps of one scene. */
  seq: number
  createdAt: string
}

/** Whether a command is waiting for its trigger, holding now, or over, as of a point in the story. */
export type CommandStatus = 'waiting' | 'in-effect' | 'ended'

/** A step as shown: where it happens in plain words. */
export interface CommandStepView extends CommandStep {
  /** "Ch 4, Sc 2" (or with the book, in a series). */
  where: string
  /** The scene is later than the point asked about (shown greyed in the whole history). */
  later: boolean
}

/** A command as it stands at a point. */
export interface CommandView {
  id: ID
  subjectId: ID
  subjectName: string
  giverId: ID | null
  giverName: string | null
  /** Its details with every step up to here laid over each other. */
  values: CommandValues
  status: CommandStatus
  /** Its effect holds now. A trigger set off 'every' time holds and waits again at once. */
  inEffect: boolean
  /** Its trigger is armed now. */
  waiting: boolean
  /** Times its trigger was set off so far. */
  fired: number
  /** The scene it was given in, and in plain words. */
  givenSceneId: ID
  givenWhere: string
  /** Its whole history (later steps marked `later`), oldest first. */
  steps: CommandStepView[]
  /** Steps the memory wasn't sure of, waiting for Adam's yes or no. */
  unsure: number
  /** Covered by an 'all' clothing command holding now (it still holds; it shows once that one lifts). */
  coveredBy: ID | null
}

/** One person under suggestion at a point: their commands and, for clothing, the net result. */
export interface PersonUnder {
  entryId: ID
  name: string
  commands: CommandView[]
  /** What they wear by command now, in plain words ("nothing", "no socks, no bra"); '' when no clothing command holds. */
  wearing: string
}

/** The Under suggestion page's data for a story, as of a scene (or the end of the story written so far). */
export interface UnderSuggestion {
  storyId: ID
  /** Tracking is on for this story. */
  on: boolean
  /** The point: as this scene ends; null for the end of the story so far. */
  sceneId: ID | null
  /** "end of Ch 6" or "Ch 6, Sc 2". */
  asOf: string
  people: PersonUnder[]
  /** Every trigger waiting now, across people, for the trigger list. */
  triggers: { commandId: ID; subjectName: string; trigger: string; does: string; triggerBy: TriggerBy; giverName: string | null }[]
  /** Reading the story so far for commands: scenes done of how many, or null when not reading. */
  reading: { done: number; total: number } | null
}

/** A new command Adam adds himself, from a scene. */
export interface CommandAdd {
  storyId: ID
  sceneId: ID
  subjectId: ID
  giverId: ID | null
  values: Partial<CommandValues>
  note?: string
}

/** A change Adam makes to a command from a scene on: what changes, or that it ends there. */
export interface CommandChange {
  commandId: ID
  sceneId: ID
  kind: 'changed' | 'stronger' | 'ended' | 'fired' | 'resisted'
  values?: Partial<CommandValues>
  note?: string
}

export interface CommandsApi {
  /** Who is under which suggestion in a story, as a scene ends (null: the end of the story so far). */
  getUnderSuggestion(storyId: ID, sceneId?: ID | null): Promise<UnderSuggestion>
  /**
   * Turns tracking on or off for a story. Turning it on reads the scenes already written for commands, one after another
   * in the background (one memory model call each), never in front of a draft.
   */
  setCommandTracking(storyId: ID, on: boolean): Promise<UnderSuggestion>
  /** Adam adds a command himself. */
  addCommand(input: CommandAdd): Promise<ID>
  /** Adam changes a command from a scene on (with Undo: `undoCommandStep`). Returns the new step's id. */
  changeCommand(input: CommandChange): Promise<ID>
  /** Takes back a step Adam made (Undo), or a whole command he added when it is its first step. */
  undoCommandStep(stepId: ID): Promise<void>
  /** Adam's yes or no to a step the memory read. */
  answerCommandStep(stepId: ID, answer: 'yes' | 'no'): Promise<void>
  /** Puts a 'no' back to unanswered (Undo of a no). */
  clearCommandAnswer(stepId: ID): Promise<void>
}

export interface CommandsEvents {
  /** A story's commands changed (a scene read, or Adam's change). */
  'commands:changed': { storyId: ID }
}
