// The Plan hub's logic (2026-10-20), with no React so it is unit-tested: where the writing has got to ("you are here":
// the last scene with words), what has been written in a line ("Ch 1 to Ch 4, Sc 2 · 31,400 words"), which parts it
// makes sense to plan from there ("the next scene", "the rest of Ch 4", "the next chapter", "the rest of Act 1"; for a new
// story "the whole story", "the first act", "the first chapter"), the story line as the hub draws it (written acts and
// chapters folded away, the chapter being written, the marker, what is planned but not written, acts with no chapters),
// and Adam's direction as it goes to the AI (his words, then the plot threads he ticked).

import type { Act, ID, Outline, SceneMeta } from '@shared/types'
import type { OutlineSize } from '@shared/contracts/outline'
import type { HubThread } from '@shared/contracts/planHub'
import type { Decisions, RunPlace, TreeNode } from '@/features/outline/tree'

/** Which part of the story a request plans. */
export type HubScopeId = 'next-scene' | 'rest-of-chapter' | 'next-chapter' | 'rest-of-act' | 'whole-story' | 'first-act' | 'first-chapter'

/** The hub's mode: a story with nothing yet, one planned but not written, or one being written. */
export type HubMode = 'start' | 'planned' | 'writing'

/** One chapter of the story, with its place and scenes, as the hub counts them. */
export interface LineChapter {
  id: ID
  /** 1 for the story's first chapter. */
  no: number
  title: string
  goal: string
  actId: ID | null
  /** 1 for the story's first act; null for a chapter with no act. */
  actNo: number | null
  scenes: LineScene[]
  words: number
}

export interface LineScene {
  id: ID
  /** 1 for the chapter's first scene. */
  no: number
  title: string
  words: number
}

/** Where the writing has got to: the last scene with words. */
export interface Where {
  sceneId: ID
  chapterId: ID
  actId: ID | null
  chapterNo: number
  sceneNo: number
  /** "Ch 4, Sc 2". */
  label: string
  /** The scene's own title ('' for a plain "Scene 2"). */
  title: string
}

/** A scene title Adam hasn't changed from the one it was made with ("Scene 3"), or none. */
export const plainTitle = (t: string): boolean => /^\s*(scene|chapter)\s*\d*\s*$|^\s*$/i.test(t)
const clean = (t: string): string => t.replace(/\s+/g, ' ').trim()
/** A scene's or chapter's title as the hub shows it ('' for one still called "Scene 3"). */
export const shownTitle = (t: string): string => (plainTitle(t) ? '' : clean(t))

/** The story's chapters in order, each with its act's number and its scenes in order. */
export function lineChapters(outline: Outline): LineChapter[] {
  const acts = outline.acts ?? []
  const actNo = new Map(acts.map((a, i) => [a.id, i + 1]))
  const byChapter = new Map<ID, SceneMeta[]>()
  for (const s of outline.scenes) {
    const list = byChapter.get(s.chapterId)
    if (list) list.push(s)
    else byChapter.set(s.chapterId, [s])
  }
  return outline.chapters.map((c, i) => {
    const scenes = (byChapter.get(c.id) ?? []).slice().sort((a, b) => a.position - b.position)
    return {
      id: c.id,
      no: i + 1,
      title: c.title,
      goal: c.goal,
      actId: c.actId ?? null,
      actNo: c.actId ? (actNo.get(c.actId) ?? null) : null,
      scenes: scenes.map((s, j) => ({ id: s.id, no: j + 1, title: s.title, words: s.wordCount })),
      words: scenes.reduce((n, s) => n + s.wordCount, 0)
    }
  })
}

/** The last scene with words, in reading order; null when nothing is written yet. */
export function whereYouAre(outline: Outline): Where | null {
  const chapters = lineChapters(outline)
  for (let c = chapters.length - 1; c >= 0; c--) {
    const ch = chapters[c]
    for (let s = ch.scenes.length - 1; s >= 0; s--) {
      const sc = ch.scenes[s]
      if (sc.words > 0)
        return { sceneId: sc.id, chapterId: ch.id, actId: ch.actId, chapterNo: ch.no, sceneNo: sc.no, label: `Ch ${ch.no}, Sc ${sc.no}`, title: shownTitle(sc.title) }
    }
  }
  return null
}

/** Words written in the story, and from where to where ("Ch 1 to Ch 4, Sc 2"; null when nothing is written). */
export function writtenLine(outline: Outline, where: Where | null = whereYouAre(outline)): { words: number; range: string | null } {
  const chapters = lineChapters(outline)
  const words = chapters.reduce((n, c) => n + c.words, 0)
  if (!where) return { words, range: null }
  const first = chapters.find((c) => c.words > 0) ?? chapters[0]
  const firstScene = first?.scenes.find((s) => s.words > 0)?.no ?? 1
  if (!first || first.no === where.chapterNo) {
    const from = firstScene
    return { words, range: from === where.sceneNo ? `Ch ${where.chapterNo}, Sc ${where.sceneNo}` : `Ch ${where.chapterNo}, Sc ${from} to Sc ${where.sceneNo}` }
  }
  return { words, range: `Ch ${first.no} to Ch ${where.chapterNo}, Sc ${where.sceneNo}` }
}

/**
 * What happens in the last scene written, in one line: its first sentences up to about 180 characters (a long summary is
 * cut at a sentence, or failing that a word, with "…").
 */
export function gistLine(gist: string, most = 180): string {
  const text = clean(gist)
  if (text.length <= most) return text
  const sentences = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*/g) ?? [text]
  let out = ''
  for (const s of sentences) {
    if (out && (out + s).trim().length > most) break
    out += s
  }
  out = out.trim()
  if (out && out.length <= most + 60) return out
  const cut = text.slice(0, most)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), most - 20)).replace(/[\s,;:]+$/, '')}…`
}

/** "31,400 words". */
export const wordsLine = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'word' : 'words'}`

/** The hub's mode (see HubMode): `blank` is the outline helper's own answer (nothing planned or written). */
export function hubMode(outline: Outline, blank: boolean | null): HubMode {
  if (whereYouAre(outline)) return 'writing'
  return blank === false ? 'planned' : 'start'
}

/** One choice of what to plan: its id, the chip's words, and its hover. */
export interface HubScope {
  id: HubScopeId
  label: string
  title: string
}

/**
 * The parts it makes sense to plan, from where the writing has got to (mid-story) or for a new story:
 * - the next scene: always, mid-story (right after the last scene written, in its chapter);
 * - the rest of Ch N: always, mid-story (after the chapter's last scene, written or planned: the plan carries on to its end);
 * - the next chapter: a new chapter after this one when it is the last, or the next chapter's scenes while it has none
 *   (one planned already, scenes and all, is picked up from the story line instead);
 * - the rest of Act N: while the act has no chapters after this one;
 * - more of the story: new acts or chapters after everything it has, in stages or all at once (always).
 * A new story (nothing written): the whole story, the first act (when it is planned in acts) and the first chapter. A
 * story planned but not written: the whole story, and the first chapter's scenes while it has none.
 */
export function scopesFor(outline: Outline, mode: HubMode, size: Pick<OutlineSize, 'acts'> | null = null): HubScope[] {
  const chapters = lineChapters(outline)
  if (mode !== 'writing') {
    const out: HubScope[] = [{ id: 'whole-story', label: mode === 'start' ? 'the whole story' : 'more of the story', title: mode === 'start' ? 'Acts, chapters and scenes for the whole story, from your idea' : 'More acts or chapters, after everything the story has' }]
    if (mode === 'start' && (size?.acts ?? 0) > 0) out.push({ id: 'first-act', label: 'the first act', title: 'Only the first act for now, with its chapters and scenes' })
    const first = chapters[0]
    if (mode === 'start') out.push({ id: 'first-chapter', label: 'the first chapter', title: 'Only the first chapter for now, with its scenes' })
    else if (first && !first.scenes.length) out.push({ id: 'first-chapter', label: 'the first chapter', title: `The scenes of Ch 1${shownTitle(first.title) ? `, “${shownTitle(first.title)}”` : ''}` })
    return out
  }
  const where = whereYouAre(outline)
  if (!where) return []
  const at = chapters.findIndex((c) => c.id === where.chapterId)
  const chapter = chapters[at]
  const out: HubScope[] = [{ id: 'next-scene', label: 'the next scene', title: `The scene that comes right after ${where.label}` }]
  if (chapter)
    out.push({ id: 'rest-of-chapter', label: `the rest of Ch ${chapter.no}`, title: `The scenes that finish Ch ${chapter.no}, after its last scene so far` })
  const next = chapters[at + 1]
  if (!next || !next.scenes.length)
    out.push({
      id: 'next-chapter',
      label: 'the next chapter',
      title: next ? `The scenes of Ch ${next.no}${shownTitle(next.title) ? `, “${shownTitle(next.title)}”` : ''}` : `A new chapter after Ch ${chapter?.no ?? where.chapterNo}, with its scenes`
    })
  if (chapter?.actId && !chapters.some((c) => c.actId === chapter.actId && c.no > chapter.no))
    out.push({ id: 'rest-of-act', label: `the rest of Act ${chapter.actNo}`, title: `The chapters that finish Act ${chapter.actNo}, after Ch ${chapter.no}` })
  // More acts or chapters after everything the story has (the outline helper's own way: in stages or all at once).
  out.push({ id: 'whole-story', label: 'more of the story', title: 'More acts or chapters after everything the story has, planned in stages or all at once' })
  return out
}

/** The scope to start on: the one asked for when it makes sense here, else the first. */
export function pickScope(scopes: readonly HubScope[], wanted: HubScopeId | null | undefined): HubScopeId | null {
  if (wanted && scopes.some((s) => s.id === wanted)) return wanted
  return scopes[0]?.id ?? null
}

// ---------- What a request asks for, and where its suggestions go ----------

/** What "Plan it" asks for, worked out from the scope and the story (helperStore and the API do the asking). */
export type HubAsk =
  | { kind: 'scenes'; chapterId: ID; chapterTitle: string; afterSceneId: ID | null; count?: number; place: RunPlace }
  | { kind: 'chapters'; actId: ID; afterChapterId: ID | null; chapters: number; place: RunPlace }
  | { kind: 'outline'; size: OutlineSize; part: string; place: RunPlace }
  | { kind: 'whole' }

/**
 * The request for a scope (see HubAsk), from where the writing has got to. Null when the scope doesn't make sense here
 * (the story changed since it was chosen). `size`: the size chosen for a new story's whole plan.
 */
export function askFor(outline: Outline, scope: HubScopeId, size: OutlineSize): HubAsk | null {
  const chapters = lineChapters(outline)
  if (scope === 'whole-story') return { kind: 'whole' }
  if (scope === 'first-act') {
    const acts = Math.max(1, size.acts)
    const chapterCount = Math.max(1, Math.round(size.chapters / acts))
    return {
      kind: 'outline',
      size: { acts: 1, chapters: chapterCount, scenes: size.scenes },
      part: `Plan only the story's first act for now (of about ${acts} ${acts === 1 ? 'act' : 'acts'} in all): how the story opens and builds, with its chapters and their scenes. The later acts are planned another time.`,
      place: { at: 'end' }
    }
  }
  if (scope === 'first-chapter') {
    const first = chapters[0]
    if (first && !first.scenes.length && whereYouAre(outline) === null && chapters.some((c) => c.goal.trim() || !plainTitle(c.title)))
      return { kind: 'scenes', chapterId: first.id, chapterTitle: first.title, afterSceneId: null, place: { at: 'chapter', chapterId: first.id } }
    return {
      kind: 'outline',
      size: { acts: 0, chapters: 1, scenes: size.scenes },
      part: "Plan only the story's first chapter for now, with its scenes: how the story opens. The rest is planned another time.",
      place: { at: 'end' }
    }
  }
  const where = whereYouAre(outline)
  if (!where) return null
  const at = chapters.findIndex((c) => c.id === where.chapterId)
  const chapter = chapters[at]
  if (!chapter) return null
  const here: RunPlace = { at: 'here', chapterId: chapter.id, afterSceneId: where.sceneId, actId: chapter.actId, afterChapterId: chapter.id }
  if (scope === 'next-scene') return { kind: 'scenes', chapterId: chapter.id, chapterTitle: chapter.title, afterSceneId: where.sceneId, count: 1, place: here }
  if (scope === 'rest-of-chapter') {
    // After the chapter's last scene, written or planned: the plan carries on to the chapter's end.
    const last = chapter.scenes[chapter.scenes.length - 1]?.id ?? where.sceneId
    return { kind: 'scenes', chapterId: chapter.id, chapterTitle: chapter.title, afterSceneId: last, place: { ...here, afterSceneId: last } }
  }
  if (scope === 'next-chapter') {
    const next = chapters[at + 1]
    if (next && next.scenes.length) return null
    if (next) return { kind: 'scenes', chapterId: next.id, chapterTitle: next.title, afterSceneId: null, place: { at: 'chapter', chapterId: next.id } }
    return {
      kind: 'outline',
      size: { acts: 0, chapters: 1, scenes: 3 },
      part: `Plan only the next chapter: the one that comes right after Ch ${chapter.no}${shownTitle(chapter.title) ? ` “${shownTitle(chapter.title)}”` : ''}, where the writing has got to (${where.label}), with its scenes.`,
      place: { ...here, chapterId: null, afterSceneId: null }
    }
  }
  if (scope === 'rest-of-act') {
    if (!chapter.actId) return null
    return { kind: 'chapters', actId: chapter.actId, afterChapterId: chapter.id, chapters: 3, place: { ...here, chapterId: null, afterSceneId: null } }
  }
  return null
}

/** The heading a batch of scenes for a chapter in the story is read under (its chapter, kept already). */
export const chapterLead = (title: string): string => `## Chapter: ${clean(title) || 'This chapter'}\n`

// ---------- Adam's direction ----------

/**
 * What goes to the AI as Adam's direction: his own words, then the plot threads he ticked ("Bring back these plot
 * threads: Bryn's debt (open since Ch 2); Who sent the rider."), then which part of a new story it is.
 */
export function directionText(words: string, threads: readonly Pick<HubThread, 'name' | 'since'>[], part = ''): string {
  const parts: string[] = []
  if (words.trim()) parts.push(words.trim())
  if (threads.length)
    parts.push(
      `Bring back ${threads.length === 1 ? 'this plot thread' : 'these plot threads'}: ${threads.map((t) => `${clean(t.name)}${t.since ? ` (open since ${t.since})` : ''}`).join('; ')}.`
    )
  if (part.trim()) parts.push(part.trim())
  return parts.join('\n\n')
}

/** A thread's chip: "+ Bryn's debt to the salt houses (since Ch 2)". */
export const threadChip = (t: Pick<HubThread, 'name' | 'since'>): string => `${clean(t.name)}${t.since ? ` (since ${t.since})` : ''}`

// ---------- The story line ----------

/** One row of the story line, before the AI's suggestions are put in their places. */
export type LineRow =
  /** A whole act written before the one being written: "✓ Act 1 · Ch 1 to Ch 3 · written". */
  | { kind: 'written-act'; key: string; act: Pick<Act, 'id' | 'title'>; actNo: number; range: string; chapters: LineChapter[] }
  /** Chapters written before the one being written, in its act or with no act: "✓ Ch 1 to Ch 3 · written". */
  | { kind: 'written-chapters'; key: string; range: string; chapters: LineChapter[] }
  /** The chapter being written: its scenes up to the last one written. */
  | { kind: 'current'; key: string; chapter: LineChapter; scenes: LineScene[] }
  /** You are here. */
  | { kind: 'here'; key: string; label: string }
  /** The chapter being written: its scenes after the last one written (planned, not written). */
  | { kind: 'planned-scenes'; key: string; chapter: LineChapter; scenes: LineScene[] }
  /** Chapters after the one being written (or all of them, nothing being written): "Ch 5 to Ch 9 · planned, not written". */
  | { kind: 'planned'; key: string; range: string; chapters: LineChapter[] }
  /** Acts with no chapters yet: "Act 2 and Act 3 · acts only". */
  | { kind: 'acts-only'; key: string; label: string; acts: { id: ID; no: number; title: string }[] }

/** "Ch 1 to Ch 3", or "Ch 4" for one. */
const chapterRange = (list: readonly LineChapter[]): string =>
  list.length === 1 ? `Ch ${list[0].no}` : `Ch ${list[0].no} to Ch ${list[list.length - 1].no}`

/** "Act 2", "Act 2 and Act 3", "Act 2, Act 3 and Act 4". */
function actsWords(nos: readonly number[]): string {
  const names = nos.map((n) => `Act ${n}`)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The story line's rows (see LineRow), in order. */
export function storyLine(outline: Outline): LineRow[] {
  const chapters = lineChapters(outline)
  const acts = outline.acts ?? []
  const where = whereYouAre(outline)
  const rows: LineRow[] = []
  const empty = acts.filter((a) => !chapters.some((c) => c.actId === a.id)).map((a) => ({ id: a.id, no: acts.indexOf(a) + 1, title: a.title }))
  const actsOnly = (list: typeof empty): LineRow[] =>
    list.length ? [{ kind: 'acts-only', key: `acts:${list.map((a) => a.id).join(',')}`, label: actsWords(list.map((a) => a.no)), acts: list }] : []
  if (!where) {
    if (chapters.length) rows.push({ kind: 'planned', key: 'planned', range: chapterRange(chapters), chapters })
    return [...rows, ...actsOnly(empty)]
  }
  const at = chapters.findIndex((c) => c.id === where.chapterId)
  const before = chapters.slice(0, at)
  const current = chapters[at]
  // Before the chapter being written: each act done with folded away whole, the rest as a run of chapters.
  let run: LineChapter[] = []
  const flush = (): void => {
    if (run.length) rows.push({ kind: 'written-chapters', key: `written:${run[0].id}`, range: chapterRange(run), chapters: run })
    run = []
  }
  for (let i = 0; i < before.length; ) {
    const c = before[i]
    if (c.actId && c.actId !== current.actId) {
      const inAct: LineChapter[] = []
      while (i < before.length && before[i].actId === c.actId) inAct.push(before[i++])
      flush()
      const act = acts.find((a) => a.id === c.actId)
      rows.push({ kind: 'written-act', key: `act:${c.actId}`, act: { id: c.actId, title: act?.title ?? '' }, actNo: c.actNo ?? 0, range: chapterRange(inAct), chapters: inAct })
      continue
    }
    run.push(c)
    i++
  }
  flush()
  // Empty acts before the one being written stay out of the way; those after it are planned later.
  const actIndex = current.actId ? acts.findIndex((a) => a.id === current.actId) : -1
  rows.push({ kind: 'current', key: `current:${current.id}`, chapter: current, scenes: current.scenes.filter((s) => s.no <= where.sceneNo) })
  rows.push({ kind: 'here', key: 'here', label: where.label })
  const rest = current.scenes.filter((s) => s.no > where.sceneNo)
  if (rest.length) rows.push({ kind: 'planned-scenes', key: `rest:${current.id}`, chapter: current, scenes: rest })
  const after = chapters.slice(at + 1)
  if (after.length) rows.push({ kind: 'planned', key: 'planned', range: chapterRange(after), chapters: after })
  return [...rows, ...actsOnly(empty.filter((a) => actIndex < 0 || a.no - 1 > actIndex))]
}

/** Where a batch of suggestions shows in the story line: the row it goes under (null: after everything). */
export function rowForPlace(rows: readonly LineRow[], place: RunPlace | null | undefined): { rowKey: string; chapterId?: ID; actId?: ID } | null {
  if (!place || place.at === 'end') return null
  if (place.at === 'here') {
    // The rest of a chapter planned past where it is written: after its planned scenes.
    const rest = rows.find((r) => r.kind === 'planned-scenes' && r.scenes.some((sc) => sc.id === place.afterSceneId))
    if (rest) return { rowKey: rest.key }
    return rows.some((r) => r.kind === 'here') ? { rowKey: 'here' } : null
  }
  if (place.at === 'chapter') {
    // Under the chapter wherever it shows: in the planned stretch, among the chapters written (their row opens), or, for
    // the chapter being written, at its end (after its planned scenes when it has some).
    const id = place.chapterId
    const row =
      rows.find((r) => r.kind === 'planned-scenes' && r.chapter.id === id) ??
      rows.find(
        (r) =>
          ((r.kind === 'planned' || r.kind === 'written-act' || r.kind === 'written-chapters') && r.chapters.some((c) => c.id === id)) ||
          (r.kind === 'current' && r.chapter.id === id)
      )
    return row ? { rowKey: row.key, chapterId: id } : null
  }
  const row = rows.find((r) => r.kind === 'acts-only' && r.acts.some((a) => a.id === place.actId))
  return row ? { rowKey: row.key, actId: place.actId } : null
}

/** The rows holding these scenes (the drift card's "Show me"): which chapters in the planned stretch to open. */
export function chaptersHolding(rows: readonly LineRow[], sceneIds: readonly ID[]): { rowKeys: string[]; chapterIds: ID[] } {
  const ids = new Set(sceneIds)
  const rowKeys = new Set<string>()
  const chapterIds = new Set<ID>()
  for (const r of rows) {
    if (r.kind === 'planned')
      for (const c of r.chapters)
        if (c.scenes.some((s) => ids.has(s.id))) {
          rowKeys.add(r.key)
          chapterIds.add(c.id)
        }
    if (r.kind === 'planned-scenes' && r.scenes.some((s) => ids.has(s.id))) rowKeys.add(r.key)
  }
  return { rowKeys: [...rowKeys], chapterIds: [...chapterIds] }
}

/**
 * What to open so a chapter (or a scene) of the story shows in the story line (Build with AI, a way in that names it):
 * the row holding it (a run of written chapters, a written act, the planned stretch) and, in the planned stretch, the
 * chapter itself, with its scenes showing. The chapter being written shows already.
 */
export function rowsToOpen(rows: readonly LineRow[], at: { chapterId?: ID | null; sceneId?: ID | null }): { rowKeys: string[]; chapterIds: ID[]; chapterId: ID | null } {
  const rowKeys: string[] = []
  const chapterIds: ID[] = []
  let chapterId: ID | null = at.chapterId ?? null
  for (const r of rows) {
    if (r.kind === 'written-act' || r.kind === 'written-chapters' || r.kind === 'planned') {
      const c = r.chapters.find((x) => x.id === at.chapterId || (!!at.sceneId && x.scenes.some((s) => s.id === at.sceneId)))
      if (!c) continue
      chapterId ??= c.id
      rowKeys.push(r.key)
      if (r.kind === 'planned') chapterIds.push(c.id)
    }
    if ((r.kind === 'current' || r.kind === 'planned-scenes') && (r.chapter.id === at.chapterId || (!!at.sceneId && r.chapter.scenes.some((s) => s.id === at.sceneId))))
      chapterId ??= r.chapter.id
  }
  return { rowKeys, chapterIds, chapterId }
}

/**
 * What each suggestion is called in the story line, by key ("Ch 4 · Sc 3", "Ch 5", "Act 2"), counting from where it
 * goes: after `base.acts` acts and `base.chapters` chapters; scenes for a chapter the story has (`lead`) after its
 * `lead.scenes` scenes. Discarded ones aren't counted, so the numbers are those Keep gives.
 */
export function suggestionLabels(
  nodes: readonly TreeNode[],
  decisions: Decisions,
  base: { acts: number; chapters: number; lead?: { chapterNo: number; scenes: number } }
): Map<string, string> {
  const out = new Map<string, string>()
  const live = (list: readonly TreeNode[]): TreeNode[] => list.filter((n) => decisions[n.key]?.status !== 'discarded')
  let acts = base.acts
  let chapters = base.chapters
  const scenes = (list: readonly TreeNode[], chapterNo: number, from: number): void =>
    live(list).forEach((s, i) => out.set(s.key, `Ch ${chapterNo} · Sc ${from + i + 1}`))
  const chapter = (c: TreeNode): void => {
    const no = ++chapters
    out.set(c.key, `Ch ${no}`)
    scenes(c.children, no, 0)
  }
  let loose = 0
  for (const n of live(nodes)) {
    if (n.kind === 'act') {
      out.set(n.key, `Act ${++acts}`)
      live(n.children).forEach(chapter)
    } else if (n.kind === 'chapter') chapter(n)
    else {
      loose++
      out.set(n.key, base.lead ? `Ch ${base.lead.chapterNo} · Sc ${base.lead.scenes + loose}` : `Sc ${loose}`)
    }
  }
  return out
}

/** The chapter heading's words for a chapter of the line: "Ch 5 · The ford". */
export const chapterName = (c: Pick<LineChapter, 'no' | 'title'>): string => `Ch ${c.no}${shownTitle(c.title) ? ` · ${shownTitle(c.title)}` : ''}`

/** A scene's words in a line of scenes: "Sc 1 The ford". */
export const sceneName = (s: Pick<LineScene, 'no' | 'title'>): string => `Sc ${s.no}${shownTitle(s.title) ? ` ${shownTitle(s.title)}` : ''}`
