// The consistency checker (milestone 5, spec "Consistency checker"). Three parts share this file; each
// changes only what it owns (see docs/ARCHITECTURE.md, "Milestone 5"):
//   Live checks   phrases to avoid, repetition nearby and name spelling, underlined as Adam types
//   AI checks     facts, knowledge, timeline and place, voice, style and tone; the Issues tab
//   Reports       the binder's badges, checking a chapter or a story, the story's Consistency page with
//                 the repetition and plot threads reports
//
// Issues live in world.db's `issues` table (migration 2, unchanged): `kind`, `severity`, `status`,
// `quote`, `message`, and everything else in `payload_json` (its `key` stops the same thing being raised
// twice, and an ignored key is never raised again). The AI calls are 'check' generation records, run by
// the shared task runner, on the "Consistency check model" (Settings › Models: the memory model until
// Adam picks one) with its own Thinking (Off).
import type { ID } from '../types'

/** What an issue is about. The keeper's and the world builder's clashes with Adam's facts are 'fact'. */
export type IssueKind =
  | 'fact'
  | 'knowledge'
  | 'timeline'
  | 'voice'
  | 'style'
  | 'continuity'
  | 'thread'
  | 'story'
  | 'phrase'
  | 'repetition'
  | 'spelling'

/** must-fix (red), warning ("Worth a look"), minor. */
export type IssueSeverity = 'must-fix' | 'warning' | 'minor'

/**
 * open: outstanding. ignored: Adam said it is intended; never raised again. fixed: Adam fixed the text or
 * updated the memory from it. gone: the words it quoted are no longer in the scene (or the scene went).
 */
export type IssueStatus = 'open' | 'ignored' | 'fixed' | 'gone'

/**
 * Which AI checks to run. Marking a scene done runs facts, knowledge, timeline and continuity; every draft runs them
 * all (Adam, 2026-10-04: a critic after each draft). Continuity is where things stand (the continuity tracker):
 * clothes, position, what is in hand, where people are, the time and light.
 */
export type CheckKind = 'facts' | 'knowledge' | 'timeline' | 'continuity' | 'voice' | 'style'

export const DONE_CHECKS: CheckKind[] = ['facts', 'knowledge', 'timeline', 'continuity']
export const ALL_CHECKS: CheckKind[] = ['facts', 'knowledge', 'timeline', 'continuity', 'voice', 'style']

/** What a check found good or not, in a sentence: the critic's report (collapsed under the Issues tab). */
export interface CheckReportItem {
  check: CheckKind
  /** True when it found nothing to report. */
  ok: boolean
  /** What it compared, and what agreed or didn't, in one or two plain sentences. */
  note: string
}

/** The latest check of a scene: when, why, what each check looked at, and how many things it found. */
export interface CheckReport {
  sceneId: ID
  /** ISO time it finished. */
  at: string
  /** 'draft': after a draft landed; 'done': Mark done; 'request': Adam asked. */
  after: 'draft' | 'done' | 'request'
  items: CheckReportItem[]
  found: number
  /** A fingerprint of the scene's words the checks read (findings that stay current, 2026-10-16). */
  textHash?: string
  /** Set by getCheckReport: true when the scene's words have changed since this check. */
  changed?: boolean
  /**
   * How the latest draft kept to its scene's contract (long story memory fix 13), item by item, from the check as it
   * landed or the chapter writer's checks. Kept until the next one; left out: no contract was checked.
   */
  contract?: ContractCheck
}

/**
 * How an item of the scene's contract came out: kept (the words show it), broken (the words go against it: an issue),
 * not yet (something that must change that the words don't show: an issue), untouched (the words don't touch it), or
 * unchecked (the check said nothing of it).
 */
export type ContractResult = 'kept' | 'broken' | 'not yet' | 'untouched' | 'unchecked'

export interface ContractCheckItem {
  /** Must be true at the start, must change, or must not change. */
  part: 'start' | 'change' | 'keep'
  text: string
  result: ContractResult
  /** The words that show it kept or broken, when the check quoted them. */
  quote?: string
  /**
   * The item as the contract had it (findings that stay current, 2026-10-16): its code, the check a broken one belongs to,
   * and the entries it is about, so a later check of the whole scene (Check this scene, Mark done) can go through the
   * scene's latest contract again. Left out by reports kept before.
   */
  code?: string
  check?: CheckKind
  entryIds?: ID[]
  /**
   * One ask of Adam's direction for the draft, in his own words (the direction receipt, 2026-10-19): something that
   * happens, how the words read ("more dialogue"), or how long they are (counted by the app). Left out: not an ask.
   */
  ask?: 'event' | 'reads' | 'length'
}

/** One check of a draft against its scene's contract. */
export interface ContractCheck {
  /** ISO time it was checked. */
  at: string
  /** What the draft was asked to write: a whole scene, a stretch of one (Add below), a beat, or Continue's words. */
  asks: 'scene' | 'stretch' | 'beat' | 'continue'
  items: ContractCheckItem[]
  /**
   * The record of the AI's words checked as they landed (the direction receipt shows for that draft, there and in What the
   * AI saw). Left out by the checks of a whole scene (Check this scene, Mark done, the chapter writer) and older reports.
   */
  recordId?: ID
}

/** What an issue conflicts with, for its links. */
export type IssueSource =
  | { kind: 'entry'; entryId: ID; name: string; field: string | null }
  | { kind: 'scene'; sceneId: ID; label: string }
  | { kind: 'thread'; entryId: ID; name: string }
  | { kind: 'story'; storyId: ID; title: string }

export interface Issue {
  id: ID
  /** The scene it is in; null for a story-wide issue (a plot thread, the world builder's summary). */
  sceneId: ID | null
  storyId: ID | null
  kind: IssueKind
  severity: IssueSeverity
  status: IssueStatus
  /** The words in the text, exactly as they stand (may be empty). */
  quote: string
  /** One plain sentence: what disagrees with what. */
  message: string
  /** What it conflicts with, each a link. */
  sources: IssueSource[]
  /**
   * A suggested rewrite of `quote` that would fix it, when the check offered one. "Fix the text" shows it
   * as a tracked change; without one, Fix the text asks the writer model (the AI tools' Rewrite).
   */
  fix: string | null
  /**
   * How the critic suggests putting it right, in a sentence, when rewriting the quoted words alone can't ("Have Dov
   * hear of the death first, or cut the line"). Shown on the card; nothing changes until Adam acts on it.
   */
  advice?: string
  /**
   * When the text is right and one of Adam's own notes is wrong: the entry and field "Update the memory"
   * sets, and the value from the text. Null when updating the memory makes no sense for this issue.
   */
  memoryFix: { entryId: ID; field: string; value: string } | null
  /** Which of the quote's appearances in the scene it is (0 for the first), when known: Fix the text works on that one. */
  occurrence?: number
  /** A common AI phrase the live checks underlined (stored as a phrase when ignored): set only then. */
  aiPhrase?: true
  /**
   * Found by a free rule over the memory, with no AI asked (long story memory fix 8: the dead speaking, one thing in two
   * hands, time running backwards): set only then.
   */
  byRule?: true
  /**
   * Found by checking a draft against its scene's contract (long story memory fix 13): something it had to keep to that
   * the words go against, or something it had to bring about that they don't show yet. Set only then.
   */
  byContract?: true
  /**
   * Put off with Later (findings that stay current, 2026-10-16): still open, but hidden until the next check of the scene
   * or until the paragraph its words are in changes. Not counted on the badges. Set only then.
   */
  later?: true
  /**
   * Ignored by "Write the whole chapter", which set it aside with its reason, not by Adam (2026-10-16): never told to later
   * checks as what he meant. Set only then.
   */
  setAsideBy?: 'chapter'
  createdAt: string
  updatedAt: string
}

/** A check of one scene, a chapter or a whole story. */
export type CheckTarget = { scope: 'scene' | 'chapter' | 'story'; id: ID }

export interface CheckStart {
  /** Made by the interface, so every event can be matched to it. */
  runId: ID
  target: CheckTarget
  checks: CheckKind[]
}

export interface CheckProgress {
  runId: ID
  target: CheckTarget
  /** Scenes checked so far, and in all (empty scenes are skipped and not counted). */
  done: number
  total: number
  /** The scene being checked now, in plain words ("Ch 3, Sc 2: The ferry"). */
  current: string | null
  /** The scenes this run checks, in order (so a scene's Issues tab can say "Checking…"). */
  sceneIds?: ID[]
  /** The scene being checked now. */
  currentSceneId?: ID | null
  /**
   * The calm overhaul: what the run is waiting for before it can check `currentSceneId`, so the window says so rather than
   * waiting in silence: 'memory' while the memory catches up with the scene and those before it (Check now goes ahead
   * without: checkWithoutWaiting). Left out: not waiting.
   */
  waiting?: 'memory'
}

export interface CheckDone {
  runId: ID
  target: CheckTarget
  status: 'complete' | 'stopped' | 'error'
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** New issues raised by this run. */
  found: number
  /** Started by marking a scene done (facts, knowledge and timeline, in the background), not by Adam. */
  background?: boolean
}

/** A word or phrase used too often: nearby in one scene, or a pet phrase across chapters. */
export interface RepetitionItem {
  phrase: string
  count: number
  /** Chapters it appears in (for a pet phrase), in story order. */
  chapterIds: ID[]
  /** The first scene it appears in, to open at the words (Reports part; optional, added in milestone 5). */
  sceneId?: ID | null
}

export interface RepetitionReport {
  storyId: ID
  /** Per chapter: words and phrases used too often in it. */
  chapters: { chapterId: ID; title: string; items: RepetitionItem[] }[]
  /** Phrases repeated across chapters. */
  petPhrases: RepetitionItem[]
}

export interface ThreadsReport {
  storyId: ID
  /** Plot threads open for many chapters with nothing happening to them. */
  openTooLong: {
    entryId: ID
    name: string
    openedIn: string
    chapters: number
    /** The scene it was set up in, to open (Reports part; optional, added in milestone 5). */
    openedAt?: { storyId: ID; sceneId: ID } | null
  }[]
  /** Payoffs (scene cards' "pays off") with no setup on the line before them. */
  noSetup: { entryId: ID; name: string; sceneId: ID; label: string }[]
}

/** Words the live checks need: every name and alias in the world, and the glossary's terms. */
export interface CheckWords {
  names: { entryId: ID; name: string; kind: string }[]
  /** Phrases to avoid, from Adam's writing preferences and the world's and story's style guides. */
  avoid: string[]
  /** Underline common AI phrases (src/shared/slop.ts): Adam's preference "avoidAiPhrases". Absent means on. */
  aiPhrases?: boolean
}

/** A live flag Adam ignored: by its key ("spelling:marra", "phrase:<paragraph id>:suddenly"). */
export interface LiveIgnore {
  kind: Extract<IssueKind, 'phrase' | 'repetition' | 'spelling'>
  key: string
}

export interface ChecksApi {
  // ----- Live checks -----
  getCheckWords(sceneId: ID): Promise<CheckWords>
  /** Keys ignored for this scene, plus spellings ignored anywhere in the world. */
  listLiveIgnores(sceneId: ID): Promise<LiveIgnore[]>
  ignoreLive(sceneId: ID, flag: LiveIgnore & { quote: string; message: string }): Promise<void>
  unignoreLive(sceneId: ID, key: string): Promise<void>

  // ----- AI checks and issues -----
  /** A scene's issues, open first (ignored and fixed ones too, for Undo and "Show ignored"). */
  listIssues(sceneId: ID): Promise<Issue[]>
  /** Every issue in a story (story-wide ones included). */
  listStoryIssues(storyId: ID): Promise<Issue[]>
  /** Open issues per scene in a story, for the binder's badges (scenes with none left out). */
  issueCounts(storyId: ID): Promise<Record<ID, { count: number; mustFix: number }>>
  /** Marks an issue as intended; it is never raised again. Undo with reopenIssue. */
  ignoreIssue(id: ID): Promise<Issue>
  reopenIssue(id: ID): Promise<Issue>
  /** After its text was fixed (a tracked change accepted). */
  markIssueFixed(id: ID): Promise<Issue>
  /** Later: hides an open issue until the next check of its scene, or until its paragraph changes. Undo with reopenIssue. */
  laterIssue(id: ID): Promise<Issue>
  /** Sets the memory from the text (`memoryFix`) as Adam's, and marks the issue fixed. */
  updateMemoryFromIssue(id: ID): Promise<Issue>
  /** Starts a check; progress arrives as checks:* events. Refuses (plain words) when no model is set up. */
  startCheck(input: CheckStart): Promise<void>
  stopCheck(runId: ID): Promise<void>

  /** The latest check's report for a scene (what was checked, what was good, what wasn't), or null. */
  getCheckReport(sceneId: ID): Promise<CheckReport | null>

  // ----- Reports -----
  getRepetitionReport(storyId: ID): Promise<RepetitionReport>
  getThreadsReport(storyId: ID): Promise<ThreadsReport>
}

export interface ChecksEvents {
  /** Issues changed for these scenes (a run, an ignore, the keeper raising one). */
  'issues:changed': { storyId: ID | null; sceneIds: ID[] }
  'checks:progress': CheckProgress
  'checks:done': CheckDone
}
