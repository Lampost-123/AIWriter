// The editor chat: applying a change it proposed, when Adam clicks Apply (or Apply all), through the same calls the
// rest of the app uses, so each lands as if Adam had made it and can be undone: words in a scene go into the page as
// one step (a snapshot is kept first; Ctrl+Z takes them back, and so does the toast's Undo, which puts back exactly
// the paragraphs the change made, open scene or not, and leaves them alone when Adam has changed them since); a card,
// an entry or a title gets its old values back; a new scene, chapter or entry goes to Recently deleted. Nothing is
// ever deleted otherwise. A new entry goes in the story the chat was asked in, whichever story is open by then.
import type { Proposal, ProposalStatus } from '@shared/contracts/ask'
import type { BuilderKind } from '@shared/contracts/builder'
import type { Issue } from '@shared/contracts/checks'
import type { CarryField, ChapterCard, ID, SceneCard } from '@shared/types'
import type { ChapterCardUpdate } from '@shared/contracts/chapterCards'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { sceneExtensions } from '@/features/editor/extensions'
import { withParagraphIds } from '@/features/editor/paragraphIds'
import { docFromStored, sceneText } from '@/features/editor/streamDoc'
import { snapshotBefore } from '@/features/history/snapshot'
import { openHistory } from '@/features/history/open'
import { changeOf, planCut, planInsert, planPassage, planRevert, planText, revertDoc, type BlockChange, type Plan } from './askEdits'
import { chatOfTurn, setProposalStatus, storyOfChat } from './askStore'
import { changeInPage, pageLanded, startProposedDraft, type Landed } from './applyDraft'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { isHeld } from '@/features/chapterWriter/hold'
import { CARRY_LABELS, chapterPartsOf, copyField, follows, sameField, withMark } from '@shared/chapterCard'
import { applyReplaceAll } from './applyReplaceAll'
import { heldWhy, notOpened, sceneInPage } from './sceneInPage'
import { threadLinkKey, withListEdited } from '@shared/threadLinks'
import { fixTheText, placesInPage, setMemoryFromIssue, settleFix } from '@/features/issues/actions'
import { noteIssueFix } from '@/features/issues/fixHistory'
import { pickOccurrence } from '@/features/issues/issuesLogic'
import { patchIssue } from '@/features/issues/issuesStore'
import { chapterCardShown, notifyChapterCard } from '@/features/chapterCard/chapterCardEvents'

const BUSY_APPLY = 'A draft is being written into this scene. Wait for it to finish, then apply.'
const BUSY_UNDO = 'A draft is being written into this scene, so the change was left in. Wait for it to finish, then undo it by hand.'
/** The page turned the change down (something holds it): nothing changed, so Apply never says it did. */
export const PAGE_REFUSED = 'The page didn’t take the change (something else is changing this scene), so nothing was changed. Try Apply again in a moment.'
const CHANGED_SINCE =
  'The words this change made were changed since, so Undo left the scene as it is. History has the scene as it was before the change.'
/** Said for a change that didn't go in and came back with no reason of its own: never dropped silently. */
export const COULDNT = 'That change couldn’t be made.'
/** A chapter card change while Write the chapter works on one of the chapter's scenes. */
export const HELD_CHAPTER = 'Write the chapter is working on this chapter. Apply it when it’s done.'

/** Why a chapter card can't change now because Write the chapter holds one of its scenes; null when it doesn't. */
export function chapterHeldWhy(chapterId: ID): string | null {
  const scenes = useOutlineStore.getState().outline?.scenes ?? []
  return scenes.some((s) => s.chapterId === chapterId && isHeld(s.id)) ? HELD_CHAPTER : null
}

/** What Undo did: done (or there was nothing left to undo), or why not, in plain words (with the scene, for History). */
export type Undone = { ok: true } | { ok: false; why: string; sceneId?: ID }

/** The outcome of applying: done (with what Undo does), or why not, in plain words. */
export type Applied = { ok: true; undo: () => Promise<Undone> } | { ok: false; why: string }

/** Where the change goes: the story the chat was asked in (null: none; undefined: not known, so the open one). */
export interface ApplyPlace {
  storyId?: ID | null
}

let storedSchemaCache: Schema | null = null
/** The scene editor's schema, for a saved scene when no page shows it. */
const storedSchema = (): Schema => (storedSchemaCache ??= getSchema(sceneExtensions()))

/**
 * Words into a scene: opens it in the page, works the change out on the page as it is, keeps a snapshot, and makes
 * it as one step (typing just before or after is a step of its own). Undo puts back exactly what it changed.
 */
async function applyWords(
  sceneId: ID,
  sceneLabel: string,
  storyId: ID | null | undefined,
  plan: (doc: Parameters<typeof planText>[0]) => Plan,
  /** Told where plain new words went and what they replaced (an issue's fix follows them: fixHistory.ts). */
  onMade?: (made: { from: number; to: number; was: string }) => void
): Promise<Applied> {
  const held = heldWhy(sceneId)
  if (held) return { ok: false, why: held }
  const editor = await sceneInPage(sceneId, storyId)
  if (!editor) return { ok: false, why: await notOpened(sceneId, sceneLabel) }
  if (editorBridge()?.busy()) return { ok: false, why: BUSY_APPLY }
  const first = plan(editor.state.doc)
  if ('why' in first) return { ok: false, why: first.why }
  await snapshotBefore(sceneId, 'Before an edit from Ask the world')
  // The page may have changed while the snapshot was kept: the change is worked out again on the page as it is now.
  const b = editorBridge()
  if (editor.isDestroyed || b?.sceneId !== sceneId) return { ok: false, why: `${sceneLabel} was closed before the change could go in.` }
  if (b.busy()) return { ok: false, why: BUSY_APPLY }
  const planned = plan(editor.state.doc)
  if ('why' in planned) return { ok: false, why: planned.why }
  const view = editor.view
  const before = view.state.doc
  view.dispatch(closeHistory(view.state.tr))
  const tr = view.state.tr
  // The words as the scene has them may differ in quote marks or spacing: the whole found range is replaced.
  if (typeof planned.content === 'string') tr.insertText(planned.content, planned.from, planned.to)
  else tr.replaceWith(planned.from, planned.to, planned.content)
  view.dispatch(tr)
  // A page that turned the change down (Write the chapter's hold, a draft's) changed nothing: never said as applied.
  if (view.state.doc.eq(before)) return { ok: false, why: heldWhy(sceneId) ?? PAGE_REFUSED }
  view.dispatch(closeHistory(view.state.tr))
  if (onMade && typeof planned.content === 'string') {
    onMade({ from: planned.from, to: planned.from + planned.content.length, was: before.textBetween(planned.from, planned.to, '\n', '\n') })
  }
  const change = changeOf(before, view.state.doc, planned)
  return { ok: true, undo: () => revertWords(sceneId, change) }
}

/**
 * Undo for words: the paragraphs the change made go back to what they were, in the page when it shows the scene
 * (one step), else in the saved scene. When they have changed since (or a draft is being written into the scene),
 * nothing is touched and the reason comes back; when they are back already (Ctrl+Z), there is nothing to do.
 */
export async function revertWords(sceneId: ID, change: BlockChange): Promise<Undone> {
  for (let tries = 0; tries < 2; tries++) {
    const bridge = editorBridge()
    const editor = bridge?.editor
    if (bridge && bridge.sceneId === sceneId && editor && !editor.isDestroyed) {
      if (bridge.busy()) return { ok: false, why: BUSY_UNDO }
      const r = planRevert(editor.state.doc, change)
      if ('why' in r) return r.why === 'already' ? { ok: true } : { ok: false, why: CHANGED_SINCE, sceneId }
      const view = editor.view
      view.dispatch(closeHistory(view.state.tr))
      view.dispatch(view.state.tr.replaceWith(r.from, r.to, r.content))
      view.dispatch(closeHistory(view.state.tr))
      return { ok: true }
    }
    // Kept off screen for a draft still being written into it: nothing else may change it.
    if (bridge?.current(sceneId)?.sceneId === sceneId) return { ok: false, why: BUSY_UNDO }
    // The saved scene: whatever is still waiting to be saved goes first, so it is read as it is.
    await flushAll()
    const scene = await api.getScene(sceneId)
    // Opened meanwhile: undone in the page instead.
    if (editorBridge()?.sceneId === sceneId) continue
    const doc = docFromStored(storedSchema(), scene.doc, scene.text)
    const next = revertDoc(doc, change)
    if ('why' in next) return next.why === 'already' ? { ok: true } : { ok: false, why: CHANGED_SINCE, sceneId }
    await api
      .takeSnapshot({ sceneId, kind: 'ai', label: 'Before undoing an edit from Ask the world', generationId: null, doc: scene.doc, text: scene.text })
      .catch(() => null)
    const fixed = withParagraphIds(next).doc
    await api.saveSceneText(sceneId, fixed.toJSON(), sceneText(fixed))
    useApp.getState().bumpOutline()
    return { ok: true }
  }
  return { ok: false, why: 'The scene was opened while the change was being undone. Try Undo again.', sceneId }
}

/** A card, an entry, a title or something new: its Undo puts it back (or says what it left, changed since). */
type Kept = { ok: true; undo: () => Promise<Undone | void> }
/** Turned down before anything changed, in plain words. */
type Refused = { ok: false; why: string }

const applyText = (p: Extract<Proposal, { kind: 'text' }>, place: ApplyPlace): Promise<Applied> =>
  // Where the chat says the words stand, when it says (the same words may be elsewhere too); else where they are.
  applyWords(p.sceneId, p.sceneLabel, place.storyId, (doc) => planText(doc, p.find, p.replace, p.at))

// ---------- Changed since the chat proposed it (R8) ----------

/** What each part of a scene or chapter card is called on screen. */
const PART_LABELS: Record<string, string> = {
  goal: 'Goal',
  conflict: 'Conflict',
  outcome: 'Outcome',
  beats: 'Beats',
  povId: CARRY_LABELS.pov,
  presentIds: CARRY_LABELS.present,
  locationId: CARRY_LABELS.location,
  when: CARRY_LABELS.when,
  mood: CARRY_LABELS.mood,
  targetWords: CARRY_LABELS.length,
  lengthSet: CARRY_LABELS.length,
  notes: CARRY_LABELS.notes,
  totalWords: 'Length of the chapter'
}

/** A chapter's parts by the Plan hub's names (its goal is "What the chapter achieves" there, not a scene's Goal). */
const CHAPTER_LABELS: Record<string, string> = { ...PART_LABELS, goal: 'What the chapter achieves' }
const ID_PARTS = new Set(['povId', 'presentIds', 'locationId'])

/** A part's value as compared: words trimmed, blank list items left out, nothing and empty alike. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string =>
    v == null ? '' : typeof v === 'string' ? v.trim() : Array.isArray(v) ? JSON.stringify(v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '')) : JSON.stringify(v)
  const x = norm(a)
  const y = norm(b)
  return x === y || ((x === '' || x === '[]') && (y === '' || y === '[]'))
}

/** A part as the card says it now, in words (an entry by its name). */
async function partNow(key: string, v: unknown): Promise<string> {
  const quoted = (s: string): string => (s.trim() ? `“${s.trim()}”` : '(empty)')
  if (key === 'totalWords') return typeof v === 'number' ? `${v.toLocaleString('en-GB')} words` : 'not set'
  if (ID_PARTS.has(key)) {
    const ids = (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is ID => typeof x === 'string')
    const names = await Promise.all(ids.map((id) => api.getEntry(id).then((e) => e.name, () => '')))
    return quoted(names.filter(Boolean).join(', '))
  }
  if (Array.isArray(v)) return quoted(v.filter((x) => typeof x === 'string' && x.trim()).join('; '))
  return quoted(v == null ? '' : String(v))
}

/** Changes Adam has been told were changed since (by what they would change and what is there now): Apply again goes. */
const toldChanged = new Set<string>()

/**
 * Whether a change's parts still read as when the chat proposed it. When they don't, Apply is turned down once with
 * what they say now; a second Apply on the same thing goes through (Adam has seen it). Null: go ahead.
 */
async function changedSince(
  p: Proposal,
  what: 'card' | 'title' | 'chapter',
  now: Record<string, unknown>,
  before: Record<string, unknown> | undefined,
  labels: Record<string, string> = PART_LABELS
): Promise<Refused | null> {
  if (!before) return null
  const moved = Object.keys(before).filter((k) => !sameValue(now[k], before[k]))
  if (!moved.length) return null
  const key = `${JSON.stringify(p)}|${JSON.stringify(moved.map((k) => now[k]))}`
  if (toldChanged.delete(key)) return null
  toldChanged.add(key)
  const said =
    what === 'title'
      ? await partNow('title', now.title)
      : (await Promise.all(moved.map(async (k) => `${labels[k] ?? k}: ${await partNow(k, now[k])}`))).join('; ')
  // Words that end a sentence inside their quotes need no full stop after them.
  const sep = /[.!?]”$/.test(said) ? '' : '.'
  return { ok: false, why: `This ${what} has changed since. Here’s what it says now: ${said}${sep} Apply again to use the chat’s change.` }
}

// ---------- Undo on a card: only what the chat changed ----------

/** The scene card part each card key is (the parts a chapter card shares). */
const CARRY_OF: Record<string, CarryField> = {
  povId: 'pov',
  presentIds: 'present',
  locationId: 'location',
  when: 'when',
  mood: 'mood',
  targetWords: 'length',
  lengthSet: 'length',
  notes: 'notes'
}

/** The keys a card change wrote (a length goes with its Auto mark). */
function patchedKeys(patch: object): string[] {
  const keys = Object.keys(patch)
  return keys.includes('targetWords') && !keys.includes('lengthSet') ? [...keys, 'lengthSet'] : keys
}

/**
 * Undo's split of a card change: the parts still as the chat left them go back; the ones changed again since (by Adam,
 * the Plan hub, another change) stay as they are.
 */
function splitBack(keys: string[], now: Record<string, unknown>, applied: Record<string, unknown>): { back: string[]; moved: string[] } {
  const back: string[] = []
  const moved: string[] = []
  for (const k of keys) (sameValue(now[k], applied[k]) ? back : moved).push(k)
  return { back, moved }
}

const pick = (from: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, from[k]]))
const rec = (c: object): Record<string, unknown> => c as Record<string, unknown>

/** What Undo says of the parts it left because they were changed since; null when it left none. */
function leftAsIs(moved: string[], labels: Record<string, string>, putBack: boolean): Undone | null {
  const names = [...new Set(moved.map((k) => labels[k] ?? k))]
  if (!names.length) return null
  const one = names.length === 1
  const list = one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return {
    ok: false,
    why: `${list} ${one ? 'was' : 'were'} changed since, so Undo left ${one ? 'it as it is' : 'them as they are'}${putBack ? ' and put the rest back' : ''}.`
  }
}

async function applyCard(p: Extract<Proposal, { kind: 'card' }>): Promise<Kept | Refused> {
  const before: SceneCard = (await api.getScene(p.sceneId)).card
  const changed = await changedSince(p, 'card', rec(before), p.before)
  if (changed) return changed
  // What was written, as the main process tidied it: what Undo tells "as the chat left it" by.
  const saved = await api.updateSceneCard(p.sceneId, { ...before, ...p.patch })
  useApp.getState().bumpBriefing()
  return {
    ok: true,
    undo: async () => {
      const scene = await api.getScene(p.sceneId)
      const now: SceneCard = scene.card
      const { back, moved } = splitBack(patchedKeys(p.patch), rec(now), rec(saved))
      if (back.length) {
        let next = { ...now, ...pick(rec(before), back) } as SceneCard
        // A part that followed its chapter before Apply follows it again (the change made it the scene's own), with what
        // the chapter it is in now says: Adam may have changed the chapter, or moved the scene, since.
        const carried = [...new Set(back.flatMap((k) => (CARRY_OF[k] ? [CARRY_OF[k]] : [])))]
        const chapter = carried.some((f) => before.inherits?.[f] === true) ? await api.getChapterCard(scene.chapterId) : null
        for (const f of carried) {
          next = withMark(next, f, before.inherits?.[f])
          if (chapter && before.inherits?.[f] === true) next = copyField(next, chapter, f)
        }
        await api.updateSceneCard(p.sceneId, next)
        useApp.getState().bumpBriefing()
      }
      return leftAsIs(moved, PART_LABELS, back.length > 0) ?? undefined
    }
  }
}

async function applyEntry(p: Extract<Proposal, { kind: 'entry' }>): Promise<Kept> {
  const before = await api.getEntry(p.entryId)
  const { fields, ...rest } = p.patch
  await api.updateEntry(p.entryId, { ...rest, ...(fields ? { fields } : {}) })
  useApp.getState().bumpEntries()
  const back = {
    ...(p.patch.summary !== undefined ? { summary: before.summary } : {}),
    ...(p.patch.description !== undefined ? { description: before.description } : {}),
    ...(p.patch.aliases !== undefined ? { aliases: before.aliases } : {}),
    ...(fields ? { fields: Object.fromEntries(Object.keys(fields).map((k) => [k, before.fields[k] ?? ''])) } : {})
  }
  return {
    ok: true,
    undo: async () => {
      await api.updateEntry(p.entryId, back)
      useApp.getState().bumpEntries()
    }
  }
}

const BUILDER_KINDS: readonly string[] = ['character', 'place', 'group', 'item'] satisfies BuilderKind[]

async function applyNewEntry(p: Extract<Proposal, { kind: 'newEntry' }>, place: ApplyPlace): Promise<Kept> {
  // The chat's story, even when another story is open by now.
  const storyId = place.storyId !== undefined ? place.storyId : useApp.getState().storyId
  const values = { name: p.name, summary: p.summary, description: p.description }
  // As the builder makes one: the AI's words marked as drafted by AI, and a character gets its read-aloud voice. An
  // event first exists at the scene it happens in (2026-10-19), so the timeline shows it there.
  const made = BUILDER_KINDS.includes(p.entryKind)
    ? await api.createBuilderEntry({ kind: p.entryKind as BuilderKind, values, aiKeys: Object.keys(values), storyId })
    : await api.createEntry(
        p.entryKind,
        { ...values, ...(p.when ? { fields: { when: p.when } } : {}), originStoryId: storyId },
        p.sceneId ? { sceneId: p.sceneId } : null
      )
  useApp.getState().bumpEntries()
  return {
    ok: true,
    undo: async () => {
      await api.deleteEntry(made.id)
      useApp.getState().bumpEntries()
    }
  }
}

async function applyNewScene(p: Extract<Proposal, { kind: 'newScene' }>): Promise<Kept> {
  const made = await api.createScene(p.chapterId, { title: p.title })
  if (Object.keys(p.card).length) {
    const { card } = await api.getScene(made.id)
    await api.updateSceneCard(made.id, { ...card, ...p.card })
  }
  useApp.getState().bumpOutline()
  return {
    ok: true,
    undo: async () => {
      await api.deleteScene(made.id)
      useApp.getState().bumpOutline()
    }
  }
}

async function applyNewChapter(p: Extract<Proposal, { kind: 'newChapter' }>): Promise<Kept> {
  const made = await api.createChapter(p.storyId, { title: p.title })
  useApp.getState().bumpOutline()
  return {
    ok: true,
    undo: async () => {
      await api.deleteChapter(made.id)
      useApp.getState().bumpOutline()
    }
  }
}

/** A scene's or chapter's title as it is now (a chapter's from its story's outline). */
async function titleNow(p: Extract<Proposal, { kind: 'rename' }>, place: ApplyPlace): Promise<string | Refused> {
  if (p.target === 'scene') return (await api.getScene(p.targetId)).title
  const storyId = place.storyId !== undefined ? place.storyId : useApp.getState().storyId
  const chapter = storyId ? (await api.getOutline(storyId)).chapters.find((c) => c.id === p.targetId) : undefined
  return chapter ? chapter.title : { ok: false, why: 'That chapter isn’t in the story any more (it may have been deleted).' }
}

async function applyRename(p: Extract<Proposal, { kind: 'rename' }>, place: ApplyPlace): Promise<Kept | Refused> {
  const now = await titleNow(p, place)
  if (typeof now !== 'string') return now
  const changed = await changedSince(p, 'title', { title: now }, { title: p.from })
  if (changed) return changed
  const set = (title: string): Promise<unknown> =>
    p.target === 'scene' ? api.updateScene(p.targetId, { title }) : api.updateChapter(p.targetId, { title })
  await set(p.to)
  useApp.getState().bumpOutline()
  return {
    ok: true,
    undo: async () => {
      await set(p.from)
      useApp.getState().bumpOutline()
    }
  }
}

/**
 * A passage rewritten across paragraphs: from its start words to its end words becomes the new paragraphs, in one
 * step (a snapshot first; Ctrl+Z or Undo takes it back). The words before the start and after the end in their
 * paragraphs stay, joined to the first and last new paragraph. Never across a scene break (askEdits.planPassage).
 */
const applyPassage = (p: Extract<Proposal, { kind: 'passage' }>, place: ApplyPlace): Promise<Applied> =>
  applyWords(p.sceneId, p.sceneLabel, place.storyId, (doc) => planPassage(doc, p.start, p.end, p.replace, p.at))

// ---------- The story changes (chat Phase 3, lab switch STORYTOOLS) ----------

type IssueFix = Extract<Proposal, { kind: 'issueFix' }>

/** A text fix with no suggested rewrite is started (Fix the text's own rewrite, a change to accept in the page). */
export const startsInPage = (p: Proposal): p is IssueFix & { sceneId: ID } => p.kind === 'issueFix' && p.how === 'text' && !p.fix && !!p.sceneId

/** The issue as it is now, while it is still open (its scene's issues read afresh); why not, in plain words. */
async function stillOpen(p: IssueFix): Promise<{ issue: Issue } | { why: string }> {
  if (!p.sceneId) return { why: 'That issue has no scene to fix.' }
  const issue = (await api.listIssues(p.sceneId)).find((i) => i.id === p.issueId)
  if (!issue || issue.status === 'gone') return { why: 'That issue’s words are no longer in the scene.' }
  if (issue.status === 'fixed') return { why: 'That issue is fixed already.' }
  if (issue.status === 'ignored') return { why: 'That issue was ignored. Reopen it in the Issues tab to fix it.' }
  return { issue }
}

/**
 * Fix the text with the check's suggested rewrite: it goes in for the issue's words as one step (a snapshot first), as
 * accepting Fix the text's change would, and the issue is marked fixed. Undo puts the words back and reopens it.
 */
async function applyIssueText(p: IssueFix, place: ApplyPlace): Promise<Applied> {
  const open = await stillOpen(p)
  if ('why' in open) return { ok: false, why: open.why }
  const sceneId = p.sceneId!
  const fix = p.fix ?? ''
  const r = await applyWords(
    sceneId,
    p.sceneLabel,
    place.storyId,
    (doc) => {
      const places = placesInPage(doc, p.quote)
      const at = pickOccurrence(places, p.occurrence)
      if (!at) return { why: places.length ? 'Those words are in the scene more than once. Use Fix the text in the Issues tab.' : 'Those words aren’t in the scene any more.' }
      const $from = doc.resolve(at.from)
      if ($from.depth !== 1) return { why: 'Those words aren’t in a plain paragraph. Use Fix the text in the Issues tab.' }
      return { from: at.from, to: at.to, content: fix, first: $from.index(0), count: 1 }
    },
    // Ctrl+Z taking the fix back reopens the issue, as the toast's Undo does.
    (made) => noteIssueFix({ id: p.issueId, sceneId }, made, made.was)
  )
  if (!r.ok) return r
  patchIssue(sceneId, p.issueId, { status: 'fixed' })
  // Saved first, so the scene's other issues on the same words go with it; then marked fixed and read again.
  await settleFix(sceneId, p.issueId)
  return {
    ok: true,
    undo: async () => {
      const u = await r.undo()
      if (u.ok) {
        await api.reopenIssue(p.issueId).catch(() => undefined)
        patchIssue(sceneId, p.issueId, { status: 'open' })
      }
      return u
    }
  }
}

/** Update the memory, as the Issues tab does it: the entry's field takes the text's value, the issue marked fixed. */
async function applyIssueMemory(p: IssueFix): Promise<Kept> {
  if (!p.memory) throw new Error('That issue has no memory fix.')
  if (p.sceneId) {
    const open = await stillOpen(p)
    if ('why' in open) throw new Error(open.why)
  }
  const { undo } = await setMemoryFromIssue({ id: p.issueId, sceneId: p.sceneId, memoryFix: { entryId: p.memory.entryId, field: p.memory.field, value: p.memory.to } })
  return { ok: true, undo: undo ?? (async () => undefined) }
}

/**
 * Fix the text with no suggested rewrite: the scene opens and Fix the text runs as in the Issues tab (the writer model
 * rewrites the sentence as a change to accept or reject in the page; accepting marks the issue fixed). `landed`: once
 * Adam accepts it, or why not once he rejects it (or it is dropped). No change in the page: it didn't start ('', as Fix
 * the text has said why).
 */
export async function startIssueFix(
  p: IssueFix & { sceneId: ID },
  storyId: ID | null | undefined
): Promise<{ ok: true; landed: Promise<Landed> } | { ok: false; why: string }> {
  const open = await stillOpen(p)
  if ('why' in open) return { ok: false, why: open.why }
  const held = heldWhy(p.sceneId)
  if (held) return { ok: false, why: held }
  const editor = await sceneInPage(p.sceneId, storyId)
  if (!editor) return { ok: false, why: await notOpened(p.sceneId, p.sceneLabel) }
  if (editorBridge()?.busy()) return { ok: false, why: BUSY_APPLY }
  const waiting = changeInPage(p.sceneId)
  fixTheText(open.issue)
  // Fix the text shows its change at once (or says why it can't).
  const id = changeInPage(p.sceneId)
  if (!id || id === waiting) return { ok: false, why: '' }
  return { ok: true, landed: pageLanded(p.sceneId, id) }
}

/** A chapter's goal as it is now (from its story's outline), or why it can't be read. */
async function chapterGoalNow(chapterId: ID, place: ApplyPlace): Promise<string | Refused> {
  const storyId = place.storyId !== undefined ? place.storyId : useApp.getState().storyId
  const chapter = storyId ? (await api.getOutline(storyId)).chapters.find((c) => c.id === chapterId) : undefined
  return chapter ? chapter.goal : { ok: false, why: 'That chapter isn’t in the story any more (it may have been deleted).' }
}

/**
 * A chapter's plan (chat-truth R5): its card's parts, written into the scenes that follow it, its length (the card's
 * totalWords) and its goal (on the chapter itself, as the Plan hub's goal box writes it). Undo puts the card, those
 * scenes and the goal back. The Plan hub's chapter page re-reads the card on notifyChapterCard, the goal on bumpOutline.
 */
async function applyChapterCard(p: Extract<Proposal, { kind: 'chapterCard' }>, place: ApplyPlace): Promise<Kept | Refused> {
  const before = await api.getChapterCard(p.chapterId)
  const setsGoal = p.goal !== undefined
  const goalNow = setsGoal || p.before?.goal !== undefined ? await chapterGoalNow(p.chapterId, place) : ''
  if (typeof goalNow !== 'string') return goalNow
  const now = { ...rec(before), goal: goalNow }
  const plan = setsGoal || 'totalWords' in p.patch
  const changed = await changedSince(p, plan ? 'chapter' : 'card', now, p.before, CHAPTER_LABELS)
  if (changed) return changed
  const card = Object.keys(p.patch).length ? await api.updateChapterCard(p.chapterId, { ...before, ...p.patch }) : null
  if (card) {
    chapterCardShown(p.chapterId, card.card)
    notifyChapterCard()
  }
  if (setsGoal) {
    try {
      await api.updateChapter(p.chapterId, { goal: p.goal })
    } catch (e) {
      // The goal didn't go in: the card goes back too, so nothing is left half done (and Apply again can go ahead).
      if (card) {
        await api.restoreChapterCard(p.chapterId, before, card.updated)
        chapterCardShown(p.chapterId, before)
        notifyChapterCard()
      }
      throw e
    }
    useApp.getState().bumpOutline()
  }
  return {
    ok: true,
    undo: async () => {
      const moved: string[] = []
      let putBack = false
      if (card) {
        const cardNow = await api.getChapterCard(p.chapterId)
        const split = splitBack(patchedKeys(p.patch), rec(cardNow), rec(card.card))
        moved.push(...split.moved)
        if (split.back.length) {
          const merged = { ...cardNow, ...pick(rec(before), split.back) } as ChapterCard
          const scenes = await chapterScenes(p.chapterId, place)
          await api.restoreChapterCard(p.chapterId, merged, await scenesBack(card.updated, split.back, card.card, before, scenes))
          chapterCardShown(p.chapterId, merged)
          notifyChapterCard()
          putBack = true
        }
      }
      if (setsGoal) {
        // The goal goes back only while it still says what the chat wrote.
        const goal = await chapterGoalNow(p.chapterId, place)
        if (typeof goal === 'string' && sameValue(goal, p.goal)) {
          await api.updateChapter(p.chapterId, { goal: goalNow })
          useApp.getState().bumpOutline()
          putBack = true
        } else if (typeof goal === 'string') moved.push('goal')
      }
      return leftAsIs(moved, CHAPTER_LABELS, putBack) ?? undefined
    }
  }
}

/** The chapter's scenes now, by id (none when its story's outline can't be read). */
async function chapterScenes(chapterId: ID, place: ApplyPlace): Promise<ID[]> {
  const storyId = place.storyId !== undefined ? place.storyId : useApp.getState().storyId
  if (!storyId) return []
  const outline = await api.getOutline(storyId).catch(() => null)
  return outline ? outline.scenes.filter((s) => s.chapterId === chapterId).map((s) => s.id) : []
}

/**
 * What a chapter card's Undo puts back in its scenes: only the parts it puts back on the card, and only in a scene that
 * still has the chat's value there (a scene's own value since, or a later chapter change, stays). A scene that can't be
 * read is passed on as it was (the main process leaves a deleted or moved scene alone). A scene made in the chapter
 * since Apply (one of `scenes` the change didn't write) that follows the part and took the chat's value goes back to
 * the chapter's value from before, still following it.
 */
async function scenesBack(
  updated: ChapterCardUpdate[],
  keys: string[],
  applied: ChapterCard,
  chapterBefore: ChapterCard,
  scenes: ID[]
): Promise<ChapterCardUpdate[]> {
  const fields = [...new Set(keys.flatMap((k) => (CARRY_OF[k] ? [CARRY_OF[k]] : [])))]
  if (!fields.length) return []
  const out: ChapterCardUpdate[] = []
  for (const u of updated) {
    const now = await api.getScene(u.sceneId).then(
      (s) => s.card as SceneCard | undefined,
      () => undefined
    )
    if (!now) {
      out.push(u)
      continue
    }
    let parts = chapterPartsOf(now)
    const marks: Record<string, boolean> = { ...(now.inherits ?? {}) }
    let any = false
    for (const f of fields) {
      if (!sameField(now, applied, f)) continue
      parts = copyField(parts, u.before.parts, f)
      const mark = u.before.inherits?.[f]
      if (mark === undefined) delete marks[f]
      else marks[f] = mark
      any = true
    }
    if (any) out.push({ sceneId: u.sceneId, before: { parts, inherits: Object.keys(marks).length ? marks : null } })
  }
  const written = new Set(updated.map((u) => u.sceneId))
  for (const sceneId of scenes) {
    if (written.has(sceneId)) continue
    const now = await api.getScene(sceneId).then(
      (s) => s.card as SceneCard | undefined,
      () => undefined
    )
    if (!now) continue
    let parts = chapterPartsOf(now)
    let any = false
    for (const f of fields) {
      if (!follows(now, f) || !sameField(now, applied, f)) continue
      parts = copyField(parts, chapterBefore, f)
      any = true
    }
    if (any) out.push({ sceneId, before: { parts, inherits: now.inherits ? { ...now.inherits } : null } })
  }
  return out
}

/**
 * A plot thread on a scene card's list, as Adam's own link (a new plot thread made first, in the chat's story). Undo
 * takes the link off (its old mark back) and the new thread to Recently deleted.
 */
async function applyThread(p: Extract<Proposal, { kind: 'thread' }>, place: ApplyPlace): Promise<Kept> {
  let threadId = p.threadId
  let made: ID | null = null
  if (!threadId) {
    const storyId = place.storyId !== undefined ? place.storyId : useApp.getState().storyId
    const e = await api.createEntry('thread', { name: p.name, ...(p.note ? { fields: { promise: p.note } } : {}), originStoryId: storyId })
    threadId = made = e.id
    useApp.getState().bumpEntries()
  }
  const id = threadId
  const key = p.list === 'setsUp' ? 'setsUpIds' : 'paysOffIds'
  const before: SceneCard = (await api.getScene(p.sceneId)).card
  const had = (before[key] ?? []).includes(id)
  if (!had) await api.updateSceneCard(p.sceneId, withListEdited(before, p.list, [...(before[key] ?? []), id]))
  useApp.getState().bumpBriefing()
  return {
    ok: true,
    undo: async () => {
      if (!had) {
        const now: SceneCard = (await api.getScene(p.sceneId)).card
        const linkKey = threadLinkKey(p.list, id)
        const marks = { ...(now.threadLinks ?? {}) }
        const was = before.threadLinks?.[linkKey]
        if (was) marks[linkKey] = was
        else delete marks[linkKey]
        await api.updateSceneCard(p.sceneId, { ...now, [key]: (now[key] ?? []).filter((x) => x !== id), threadLinks: marks })
      }
      if (made) {
        await api.deleteEntry(made)
        useApp.getState().bumpEntries()
      }
      useApp.getState().bumpBriefing()
    }
  }
}

/** Undo for a change to a record, which always can be put back (or why it was turned down). */
const kept = async (r: Promise<Kept | Refused>): Promise<Applied> => {
  const k = await r
  if (!k.ok) return k
  return {
    ok: true,
    undo: async () => (await k.undo()) ?? { ok: true }
  }
}

// ---------- TEXTTOOLS (chat Phase 3): inserts, cuts and beats ----------

/**
 * New paragraphs next to the one the chat named, in one step (a snapshot first; Ctrl+Z or Undo takes them back, and
 * Undo leaves them alone once Adam has changed them).
 */
const applyInsert = (p: Extract<Proposal, { kind: 'insert' }>, place: ApplyPlace): Promise<Applied> =>
  applyWords(p.sceneId, p.sceneLabel, place.storyId, (doc) => planInsert(doc, p))

/** Whole paragraphs out, only while they read as the chat read them; Undo puts them back between their neighbours. */
const applyCut = (p: Extract<Proposal, { kind: 'cut' }>, place: ApplyPlace): Promise<Applied> =>
  applyWords(p.sceneId, p.sceneLabel, place.storyId, (doc) => planCut(doc, p))

const filledBeats = (beats: readonly string[]): string[] => beats.map((b) => b.trim()).filter(Boolean)
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export const BEATS_CHANGED = 'The scene’s beats were changed since this was proposed, so they were left as they are. Ask again for a fresh change.'
export const BEATS_UNDO_CHANGED = 'The scene’s beats were changed since, so Undo left them as they are.'

/**
 * A scene card's beats, through the usual card update, only while the card has the beats the chat saw. Undo puts the
 * old beats back (the card's other parts as they are by then), unless the beats were changed since.
 */
async function applyBeats(p: Extract<Proposal, { kind: 'beats' }>): Promise<Applied> {
  const card: SceneCard = (await api.getScene(p.sceneId)).card
  if (!sameList(filledBeats(card.beats), p.before)) return { ok: false, why: BEATS_CHANGED }
  const old = card.beats
  await api.updateSceneCard(p.sceneId, { ...card, beats: p.beats })
  useApp.getState().bumpBriefing()
  return {
    ok: true,
    undo: async (): Promise<Undone> => {
      const now: SceneCard = (await api.getScene(p.sceneId)).card
      const beats = filledBeats(now.beats)
      if (sameList(beats, p.before)) return { ok: true }
      if (!sameList(beats, p.beats)) return { ok: false, why: BEATS_UNDO_CHANGED }
      await api.updateSceneCard(p.sceneId, { ...now, beats: old })
      useApp.getState().bumpBriefing()
      return { ok: true }
    }
  }
}

/** Carries out one proposed change. Never throws: a problem comes back in plain words. */
export async function applyProposal(p: Proposal, place: ApplyPlace = {}): Promise<Applied> {
  try {
    // Write the chapter holds the scene: nothing goes into it, its words or its card, until the run ends.
    const held = p.kind === 'draft' ? null : p.kind === 'chapterCard' ? chapterHeldWhy(p.chapterId) : heldWhy('sceneId' in p ? p.sceneId : null)
    if (held) return { ok: false, why: held }
    switch (p.kind) {
      case 'text':
        return await applyText(p, place)
      case 'passage':
        return await applyPassage(p, place)
      case 'card':
        return await kept(applyCard(p))
      case 'entry':
        return await kept(applyEntry(p))
      case 'newEntry':
        return await kept(applyNewEntry(p, place))
      case 'newScene':
        return await kept(applyNewScene(p))
      case 'newChapter':
        return await kept(applyNewChapter(p))
      case 'rename':
        return await kept(applyRename(p, place))
      case 'issueFix':
        if (p.how === 'memory') return await kept(applyIssueMemory(p))
        if (!p.fix) return { ok: false, why: 'This fix is started from its own card.' }
        return await applyIssueText(p, place)
      case 'chapterCard':
        return await kept(applyChapterCard(p, place))
      case 'thread':
        return await kept(applyThread(p, place))
      case 'draft':
        // A proposed draft starts the writer's own job (applyDraft.ts): applyAndKeep starts it, with no Undo of its own.
        return { ok: false, why: 'A proposed draft is started from its own card.' }
      case 'insert':
        return await applyInsert(p, place)
      case 'cut':
        return await applyCut(p, place)
      case 'beats':
        return await applyBeats(p)
      case 'replaceAll':
        // Phase 4 (EXTRATOOLS): through the app's own Find and replace (applyReplaceAll.ts).
        return await applyReplaceAll(p, place)
    }
  } catch (e) {
    return { ok: false, why: (e as Error)?.message || 'That change couldn’t be applied.' }
  }
}

/** The story a chat's changes go in: the chat's own (from its id), else (no chat id yet) the open story. */
export function storyForChanges(generationId: ID): ID | null {
  const s = storyOfChat(chatOfTurn(generationId))
  return s !== undefined ? s : useApp.getState().storyId
}

/**
 * What applying a set of changes did, and Undo for each (in the order applied). A proposed draft is started instead
 * (`started`: its scene's label); it is undone in the scene, as any draft is, so it has no Undo here.
 */
export async function applyAndKeep(
  generationId: ID,
  list: Proposal[],
  place: ApplyPlace = { storyId: storyForChanges(generationId) }
): Promise<{
  done: number
  undos: (() => Promise<Undone>)[]
  failed: string[]
  started: { sceneId: ID; label: string; message?: string }[]
  /** Each applied change's Undo, by its id (a change card's own Undo). */
  undoOf: Record<string, () => Promise<Undone>>
  /** Why each change that couldn't be applied wasn't, by its id. */
  failedOf: Record<string, string>
  /**
   * How each started change (a draft, an in-page fix) ended, by its id: its card is 'started' until then, then
   * 'applied', or 'pending' again with the reason.
   */
  landedOf: Record<string, Promise<Landed>>
}> {
  const undos: (() => Promise<Undone>)[] = []
  const failed: string[] = []
  const started: { sceneId: ID; label: string; message?: string }[] = []
  const undoOf: Record<string, () => Promise<Undone>> = {}
  const failedOf: Record<string, string> = {}
  const landedOf: Record<string, Promise<Landed>> = {}
  // Never dropped silently: a change that didn't go in and gave no reason says so.
  const fail = (p: Proposal, why: string): void => {
    failed.push(why || COULDNT)
    failedOf[p.id] = why || COULDNT
  }
  // Started is not applied: the card says Started, and turns Applied (or waits again) when the job ends.
  const begin = async (p: Proposal, landed: Promise<Landed>): Promise<void> => {
    await setProposalStatus(generationId, p.id, 'started')
    landedOf[p.id] = landed.then(async (l) => {
      await setProposalStatus(generationId, p.id, l.ok ? 'applied' : 'pending')
      return l
    })
  }
  for (const p of list) {
    // A text fix with no suggested rewrite runs Fix the text in the page: a change to accept or reject there.
    if (startsInPage(p)) {
      const s = await startIssueFix(p, place.storyId)
      if (s.ok) {
        started.push({ sceneId: p.sceneId, label: p.sceneLabel, message: `The fix is being written in ${p.sceneLabel}: accept or reject it there.` })
        await begin(p, s.landed)
      } else fail(p, s.why)
      continue
    }
    if (p.kind === 'draft') {
      const s = await startProposedDraft(p, place.storyId)
      if (s.ok) {
        started.push({ sceneId: p.sceneId, label: p.sceneLabel })
        await begin(p, s.landed)
      } else fail(p, s.why)
      continue
    }
    const r = await applyProposal(p, place)
    if (r.ok) {
      const undo = async (): Promise<Undone> => {
        const u = await r.undo()
        // Waiting again only when the change really is undone.
        if (u.ok) await setProposalStatus(generationId, p.id, 'pending')
        return u
      }
      undos.push(undo)
      undoOf[p.id] = undo
      await setProposalStatus(generationId, p.id, 'applied')
    } else fail(p, r.why)
  }
  return { done: undos.length, undos, failed, started, undoOf, failedOf, landedOf }
}

/** What Undo says when the scene or chapter a change was made in has been deleted since (the main process's words). */
const DELETED_SINCE: Record<string, string> = {
  'That scene no longer exists.': 'That scene was deleted, so there’s nothing to undo. Settings › Recently deleted can bring it back.',
  'That chapter no longer exists.': 'That chapter was deleted, so there’s nothing to undo. Settings › Recently deleted can bring it back.'
}

/** Why an Undo couldn't go ahead, in plain words. */
function undoFailed(e: unknown): Undone {
  const message = (e as Error)?.message ?? ''
  return { ok: false, why: DELETED_SINCE[message] ?? (message || 'That change couldn’t be undone.') }
}

/** Undoes changes, the latest first, and says plainly what couldn't be (with the scene's History to hand). */
export async function undoChanges(undos: (() => Promise<Undone>)[]): Promise<Undone[]> {
  const results: Undone[] = []
  for (const u of [...undos].reverse()) results.push(await u().catch(undoFailed))
  const left = results.filter((r): r is Extract<Undone, { ok: false }> => !r.ok)
  if (left.length) {
    const first = left[0]
    const sceneId = left.find((r) => r.sceneId)?.sceneId
    toast(left.length === 1 ? first.why : `${left.length} changes couldn’t be undone. ${first.why}`, {
      tone: 'danger',
      ...(sceneId ? { action: { label: 'Open History', run: () => void openHistory(sceneId) } } : {})
    })
  }
  return results
}

/** Shows a scene in the page (a started draft's "Show"). */
export function showScene(sceneId: ID): void {
  const app = useApp.getState()
  if (app.view.kind !== 'write' || app.sceneId !== sceneId) app.selectScene(sceneId)
}

/**
 * Applies the changes picked (one, or every one still waiting with Apply all), says how it went, and offers Undo. Comes
 * back with each applied change's own Undo (a change card's), by id, and why each that failed did: the toast's Undo
 * then undoes only those not undone from their cards already.
 */
export async function applyChanges(
  generationId: ID,
  list: Proposal[]
): Promise<{
  undoOf: Record<string, () => Promise<void>>
  failedOf: Record<string, string>
  /** How each started change ended (applyAndKeep): one that didn't land says why. */
  landedOf: Record<string, Promise<Landed>>
}> {
  const { done, failed, started, undoOf, failedOf, landedOf } = await applyAndKeep(generationId, list)
  if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} changes couldn’t be applied. ${failed[0]}`, { tone: 'danger' })
  // A draft says where it is being written; its words are kept or undone in the scene, as any draft's are.
  for (const s of started) toast(s.message ?? `The draft has started in ${s.label}.`, { action: { label: 'Show', run: () => showScene(s.sceneId) } })
  // One that ends without landing (stopped, failed, rejected in the page) says why; its card waits again.
  for (const l of Object.values(landedOf)) void l.then((r) => (r.ok ? undefined : void toast(r.why)))
  // Each change is undone once, from its card or from the toast, whichever comes first.
  const left = new Map(Object.entries(undoOf))
  const once: Record<string, () => Promise<void>> = {}
  for (const [id, u] of left) {
    once[id] = async () => {
      if (!left.delete(id)) return
      await undoChanges([u])
    }
  }
  if (!done) return { undoOf: once, failedOf, landedOf }
  toast(done === 1 ? 'Change applied.' : `${done} changes applied.`, {
    tone: 'success',
    action: {
      label: 'Undo',
      run: () => {
        const all = [...left.values()]
        left.clear()
        if (all.length) void undoChanges(all)
      }
    }
  })
  return { undoOf: once, failedOf, landedOf }
}

/** Not this: the change is set aside (it can still be applied later). */
export const declineChange = (generationId: ID, p: Proposal, status: ProposalStatus = 'declined'): Promise<void> =>
  setProposalStatus(generationId, p.id, status)
