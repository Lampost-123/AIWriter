// One Issues list, in clear sections (the calm overhaul, 2026-10-19: nine kinds of checking fed the Issues tab, the
// Critique tab, the Check room and the memory's "Worth a look", each its own way). Every finding goes in one of five:
//   Slips          words that disagree with the memory, earlier scenes or the free rules: put them right in the words
//   Questions      things only Adam can decide: what the scene's contract asked for, the text or his note, voice and style
//   Craft notes    the critic's notes on the writing (what was the Critique tab), only when he asks
//   Plot threads   threads left open too long, paid off with no setup, or waiting for their pay-off
//   Memory         what the memory isn't sure about in this scene, and a scene its model turned down
// The filters show one section or all. Pure (with the small store of which filter is on), so it is unit-tested.
import { create } from 'zustand'
import type { Issue } from '@shared/contracts/checks'

export type IssueSection = 'slips' | 'questions' | 'craft' | 'threads' | 'memory'

/** The sections in the order the list shows them. */
export const SECTIONS: readonly IssueSection[] = ['slips', 'questions', 'craft', 'threads', 'memory']

export const SECTION_WORDS: Record<IssueSection, string> = {
  slips: 'Slips',
  questions: 'Questions',
  craft: 'Craft notes',
  threads: 'Plot threads',
  memory: 'Memory'
}

/** What each section holds, in a line (its heading's hint). */
export const SECTION_HINTS: Record<IssueSection, string> = {
  slips: 'Words that disagree with the memory, earlier scenes or the rules. Put them right in the words.',
  questions: 'Things only you can decide: what the scene had to do, whether the text or your note is right, voice and style.',
  craft: 'The critic’s notes on the writing. It reads only when you ask.',
  threads: 'Plot threads to look at: left open too long, or waiting for their payoff.',
  memory: 'What the memory isn’t sure about in this scene.'
}

/**
 * Which section an issue from the checks belongs in (Craft notes and Memory have their own sources). A question is one
 * asked of Adam (check and repair asks "Use the fix, or keep it as it is?"), one about the scene's contract or with no
 * words to point at, one where the text or his own note may be the one that's wrong, and voice, style and other stories.
 */
export function sectionOf(issue: Pick<Issue, 'kind' | 'quote' | 'byContract' | 'memoryFix'> & { message?: string }): 'slips' | 'questions' | 'threads' {
  if (issue.kind === 'thread') return 'threads'
  if (issue.byContract || !issue.quote.trim() || issue.memoryFix || /\?\s*$/.test(issue.message ?? '')) return 'questions'
  if (issue.kind === 'voice' || issue.kind === 'style' || issue.kind === 'story') return 'questions'
  return 'slips'
}

/** The issues of each section, in the order given (must fix first, as the main process sorts them). */
export function bySection<T extends Pick<Issue, 'kind' | 'quote' | 'byContract' | 'memoryFix'> & { message?: string }>(issues: T[]): Record<'slips' | 'questions' | 'threads', T[]> {
  const out: Record<'slips' | 'questions' | 'threads', T[]> = { slips: [], questions: [], threads: [] }
  for (const i of issues) out[sectionOf(i)].push(i)
  return out
}

/** How many things each section has to look at, and in all (Craft notes count the critic's notes still to do). */
export function sectionCounts(o: { issues: (Pick<Issue, 'kind' | 'quote' | 'byContract' | 'memoryFix'> & { message?: string })[]; craft: number; memory: number; threads?: number }): Record<IssueSection | 'all', number> {
  const s = bySection(o.issues)
  const threads = s.threads.length + (o.threads ?? 0)
  const counts = { slips: s.slips.length, questions: s.questions.length, craft: o.craft, threads, memory: o.memory }
  return { ...counts, all: counts.slips + counts.questions + counts.craft + counts.threads + counts.memory }
}

/** "2 slips · 1 question" for the list's head: what there is to look at, the sections with any, in order. */
export function sectionSummary(counts: Record<IssueSection, number>): string {
  const one: Record<IssueSection, [string, string]> = {
    slips: ['slip', 'slips'],
    questions: ['question', 'questions'],
    craft: ['craft note', 'craft notes'],
    threads: ['plot thread', 'plot threads'],
    memory: ['memory note', 'memory notes']
  }
  return SECTIONS.filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${one[k][counts[k] === 1 ? 0 : 1]}`)
    .join(' · ')
}

interface IssuesView {
  /** The filter on: one section, or all of them. */
  section: IssueSection | 'all'
  show: (section: IssueSection | 'all') => void
}

/** Which section the Issues list shows (kept while the app runs, so coming back shows the same). */
export const useIssuesView = create<IssuesView>((set) => ({ section: 'all', show: (section) => set({ section }) }))
