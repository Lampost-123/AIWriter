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
