// The editor chat: applying a change it proposed, when Adam clicks Apply (or Apply all), through the same calls the
// rest of the app uses, so each lands as if Adam had made it and can be undone: words in a scene go into the page as
// one step (a snapshot is kept first; Ctrl+Z takes them back, and so does the toast's Undo, which puts back exactly
// the paragraphs the change made, open scene or not, and leaves them alone when Adam has changed them since); a card,
// an entry or a title gets its old values back; a new scene, chapter or entry goes to Recently deleted. Nothing is
// ever deleted otherwise. A new entry goes in the story the chat was asked in, whichever story is open by then.
import type { Proposal, ProposalStatus } from '@shared/contracts/ask'
import type { BuilderKind } from '@shared/contracts/builder'
import type { ID, SceneCard } from '@shared/types'
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
import { startProposedDraft } from './applyDraft'
import { sceneInPage } from './sceneInPage'

const BUSY_APPLY = 'A draft is being written into this scene. Wait for it to finish, then apply.'
const BUSY_UNDO = 'A draft is being written into this scene, so the change was left in. Wait for it to finish, then undo it by hand.'
const CHANGED_SINCE =
  'The words this change made were changed since, so Undo left the scene as it is. History has the scene as it was before the change.'

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
async function applyWords(sceneId: ID, sceneLabel: string, storyId: ID | null | undefined, plan: (doc: Parameters<typeof planText>[0]) => Plan): Promise<Applied> {
  const editor = await sceneInPage(sceneId, storyId)
  if (!editor) return { ok: false, why: `${sceneLabel} couldn’t be opened.` }
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
  view.dispatch(closeHistory(view.state.tr))
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

/** A card, an entry, a title or something new: its Undo always can put it back. */
type Kept = { ok: true; undo: () => Promise<void> }

const applyText = (p: Extract<Proposal, { kind: 'text' }>, place: ApplyPlace): Promise<Applied> =>
  // Where the chat says the words stand, when it says (the same words may be elsewhere too); else where they are.
  applyWords(p.sceneId, p.sceneLabel, place.storyId, (doc) => planText(doc, p.find, p.replace, p.at))

async function applyCard(p: Extract<Proposal, { kind: 'card' }>): Promise<Kept> {
  const before: SceneCard = (await api.getScene(p.sceneId)).card
  await api.updateSceneCard(p.sceneId, { ...before, ...p.patch })
  useApp.getState().bumpBriefing()
  return {
    ok: true,
    undo: async () => {
      await api.updateSceneCard(p.sceneId, before)
      useApp.getState().bumpBriefing()
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
  // As the builder makes one: the AI's words marked as drafted by AI, and a character gets its read-aloud voice.
  const made = BUILDER_KINDS.includes(p.entryKind)
    ? await api.createBuilderEntry({ kind: p.entryKind as BuilderKind, values, aiKeys: Object.keys(values), storyId })
    : await api.createEntry(p.entryKind, { ...values, originStoryId: storyId })
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

async function applyRename(p: Extract<Proposal, { kind: 'rename' }>): Promise<Kept> {
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

/** Undo for a change to a record, which always can be put back. */
const kept = async (r: Promise<Kept>): Promise<Applied> => {
  const k = await r
  return {
    ok: true,
    undo: async () => {
      await k.undo()
      return { ok: true }
    }
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
        return await kept(applyRename(p))
      case 'draft':
        // A proposed draft starts the writer's own job (applyDraft.ts): applyAndKeep starts it, with no Undo of its own.
        return { ok: false, why: 'A proposed draft is started from its own card.' }
      case 'insert':
        return await applyInsert(p, place)
      case 'cut':
        return await applyCut(p, place)
      case 'beats':
        return await applyBeats(p)
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
  started: { sceneId: ID; label: string }[]
  /** Each applied change's Undo, by its id (a change card's own Undo). */
  undoOf: Record<string, () => Promise<Undone>>
  /** Why each change that couldn't be applied wasn't, by its id. */
  failedOf: Record<string, string>
}> {
  const undos: (() => Promise<Undone>)[] = []
  const failed: string[] = []
  const started: { sceneId: ID; label: string }[] = []
  const undoOf: Record<string, () => Promise<Undone>> = {}
  const failedOf: Record<string, string> = {}
  for (const p of list) {
    if (p.kind === 'draft') {
      const s = await startProposedDraft(p, place.storyId)
      if (s.ok) {
        started.push({ sceneId: p.sceneId, label: p.sceneLabel })
        await setProposalStatus(generationId, p.id, 'applied')
      } else if (s.why) {
        failed.push(s.why)
        failedOf[p.id] = s.why
      }
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
    } else {
      failed.push(r.why)
      failedOf[p.id] = r.why
    }
  }
  return { done: undos.length, undos, failed, started, undoOf, failedOf }
}

/** Undoes changes, the latest first, and says plainly what couldn't be (with the scene's History to hand). */
export async function undoChanges(undos: (() => Promise<Undone>)[]): Promise<Undone[]> {
  const results: Undone[] = []
  for (const u of [...undos].reverse()) {
    results.push(await u().catch((e: unknown): Undone => ({ ok: false, why: (e as Error)?.message || 'That change couldn’t be undone.' })))
  }
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
): Promise<{ undoOf: Record<string, () => Promise<void>>; failedOf: Record<string, string> }> {
  const { done, failed, started, undoOf, failedOf } = await applyAndKeep(generationId, list)
  if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} changes couldn’t be applied. ${failed[0]}`, { tone: 'danger' })
  // A draft says where it is being written; its words are kept or undone in the scene, as any draft's are.
  for (const s of started) toast(`The draft has started in ${s.label}.`, { action: { label: 'Show', run: () => showScene(s.sceneId) } })
  // Each change is undone once, from its card or from the toast, whichever comes first.
  const left = new Map(Object.entries(undoOf))
  const once: Record<string, () => Promise<void>> = {}
  for (const [id, u] of left) {
    once[id] = async () => {
      if (!left.delete(id)) return
      await undoChanges([u])
    }
  }
  if (!done) return { undoOf: once, failedOf }
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
  return { undoOf: once, failedOf }
}

/** Not this: the change is set aside (it can still be applied later). */
export const declineChange = (generationId: ID, p: Proposal, status: ProposalStatus = 'declined'): Promise<void> =>
  setProposalStatus(generationId, p.id, status)
