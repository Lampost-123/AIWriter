// Pure helpers for the story's Consistency page: its issues grouped by chapter and scene in story
// order (story-wide ones first, must-fix first in each group), the words for severities, kinds and
// places, and the reports' chapters by number. Tested in consistencyLogic.test.ts.
import type { ID, Outline } from '@shared/types'
import type { Issue, IssueKind, IssueSeverity, RepetitionReport } from '@shared/contracts/checks'

export const SEVERITY_WORDS: Record<IssueSeverity, string> = { 'must-fix': 'Must fix', warning: 'Worth a look', minor: 'Minor' }

export const KIND_WORDS: Record<IssueKind, string> = {
  fact: 'Facts',
  knowledge: 'Knowledge',
  timeline: 'Timeline and place',
  voice: 'Voice',
  style: 'Style and tone',
  thread: 'Plot thread',
  story: 'Between stories',
  phrase: 'Phrase to avoid',
  repetition: 'Repetition',
  spelling: 'Name spelling'
}

const RANK: Record<IssueSeverity, number> = { 'must-fix': 0, warning: 1, minor: 2 }

/** Open before ignored, must fix first, then the order they were raised. */
export const issueOrder = (a: Issue, b: Issue): number =>
  Number(a.status === 'ignored') - Number(b.status === 'ignored') ||
  RANK[a.severity] - RANK[b.severity] ||
  (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)

export interface SceneGroup {
  sceneId: ID
  /** "Sc 2" and its title ("The ferry", or '' when it has none). */
  label: string
  title: string
  issues: Issue[]
}

export interface ChapterGroup {
  chapterId: ID
  label: string
  title: string
  scenes: SceneGroup[]
}

export interface IssueGroups {
  /** Story-wide issues (no scene), shown first. */
  story: Issue[]
  chapters: ChapterGroup[]
  /** Open issues, those that must be fixed, and ignored ones (whether shown or not). */
  open: number
  mustFix: number
  ignored: number
}

/**
 * The story's issues to show: open ones (and ignored ones with `showIgnored`), grouped by chapter and scene
 * in the outline's order. Fixed and gone issues, and issues of scenes no longer in the story, are left out.
 */
export function groupIssues(issues: Issue[], outline: Outline | null, showIgnored: boolean): IssueGroups {
  const shown = issues.filter((i) => i.status === 'open' || (showIgnored && i.status === 'ignored'))
  const scenesInStory = new Set(outline?.scenes.map((s) => s.id) ?? [])
  const live = issues.filter((i) => i.sceneId === null || scenesInStory.has(i.sceneId))
  const out: IssueGroups = {
    story: shown.filter((i) => i.sceneId === null).sort(issueOrder),
    chapters: [],
    open: live.filter((i) => i.status === 'open').length,
    mustFix: live.filter((i) => i.status === 'open' && i.severity === 'must-fix').length,
    ignored: live.filter((i) => i.status === 'ignored').length
  }
  if (!outline) return out
  const byScene = new Map<ID, Issue[]>()
  for (const i of shown) {
    if (i.sceneId === null) continue
    const list = byScene.get(i.sceneId)
    if (list) list.push(i)
    else byScene.set(i.sceneId, [i])
  }
  outline.chapters.forEach((c, ci) => {
    const scenes: SceneGroup[] = []
    outline.scenes
      .filter((s) => s.chapterId === c.id)
      .forEach((s, si) => {
        const list = byScene.get(s.id)
        if (list?.length) scenes.push({ sceneId: s.id, label: `Sc ${si + 1}`, title: s.title.trim(), issues: list.sort(issueOrder) })
      })
    if (scenes.length) out.chapters.push({ chapterId: c.id, label: `Ch ${ci + 1}`, title: c.title.trim(), scenes })
  })
  return out
}

/** "3 open issues, 1 must fix", "No open issues". */
export function issueSummary(g: Pick<IssueGroups, 'open' | 'mustFix'>): string {
  if (!g.open) return 'No open issues'
  const open = `${g.open} open ${g.open === 1 ? 'issue' : 'issues'}`
  return g.mustFix ? `${open}, ${g.mustFix} must fix` : open
}

/** Each chapter's number ("Ch 3") by id, in the report's order (every live chapter is in it). */
export function chapterNumbers(report: Pick<RepetitionReport, 'chapters'>): Map<ID, string> {
  return new Map(report.chapters.map((c, i) => [c.chapterId, `Ch ${i + 1}`]))
}

/** "Ch 1, Ch 3 and Ch 7"; long lists end "and 4 more". */
export function chapterList(ids: ID[], numbers: Map<ID, string>, max = 6): string {
  const names = ids.map((id) => numbers.get(id)).filter((n): n is string => !!n)
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > max) return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Used 9 times", "In 4 chapters, 6 times". */
export function timesWords(count: number, chapters?: number): string {
  const times = count === 1 ? 'once' : `${count} times`
  return chapters ? `In ${chapters} chapters, ${times}` : `Used ${times}`
}
