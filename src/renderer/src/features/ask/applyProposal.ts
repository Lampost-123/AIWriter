// The editor chat: applying a change it proposed, when Adam clicks Apply (or Apply all), through the same calls the
// rest of the app uses, so each lands as if Adam had made it and can be undone: words in a scene go into the page as
// one step (a snapshot is kept first, and Ctrl+Z or the toast's Undo takes them back); a card, an entry or a title
// gets its old values back; a new scene, chapter or entry goes to Recently deleted. Nothing is ever deleted otherwise.
import type { Proposal, ProposalStatus } from '@shared/contracts/ask'
import type { BuilderKind } from '@shared/contracts/builder'
import type { ID, SceneCard } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { findTextRange, findTextRangeAfter } from '@/features/editor/findText'
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { snapshotBefore } from '@/features/history/snapshot'
import { setProposalStatus } from './askStore'

/** How long to wait for a scene to open in the page before giving up. */
const OPEN_WAIT_MS = 4000

/** Opens a scene in the page (if it isn't) and resolves once the editor shows it; null if it didn't in time. */
async function sceneInPage(sceneId: ID, storyId?: ID | null): Promise<NonNullable<ReturnType<typeof editorBridge>>['editor']> {
  const app = useApp.getState()
  if (app.view.kind !== 'write' || app.sceneId !== sceneId) app.selectScene(sceneId, storyId ?? undefined)
  const until = Date.now() + OPEN_WAIT_MS
  for (;;) {
    const b = editorBridge()
    if (b?.sceneId === sceneId && b.editor && !b.editor.isDestroyed) return b.editor
    if (Date.now() > until) return null
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** The outcome of applying: done (with what Undo does), or why not, in plain words. */
export type Applied = { ok: true; undo: () => Promise<void> } | { ok: false; why: string }

async function applyText(p: Extract<Proposal, { kind: 'text' }>): Promise<Applied> {
  const editor = await sceneInPage(p.sceneId)
  if (!editor) return { ok: false, why: `${p.sceneLabel} couldn’t be opened.` }
  if (editorBridge()?.busy()) return { ok: false, why: 'A draft is being written into this scene. Wait for it to finish, then apply.' }
  const range = findTextRange(editor.state.doc, p.find)
  if (!range) {
    return {
      ok: false,
      why: 'The words this change looks for aren’t in the scene any more: another change or your own editing changed them. Ask again for a fresh one.'
    }
  }
  await snapshotBefore(p.sceneId, 'Before an edit from Ask the world')
  // The words as the scene has them may differ in quote marks or spacing: the whole found range is replaced.
  const { from, to } = range
  editor
    .chain()
    .command(({ tr }) => {
      if (p.replace) tr.insertText(p.replace, from, to)
      else tr.delete(from, to)
      return true
    })
    .run()
  return {
    ok: true,
    undo: async () => {
      const b = editorBridge()
      if (b?.sceneId === p.sceneId) b.undo()
    }
  }
}

async function applyCard(p: Extract<Proposal, { kind: 'card' }>): Promise<Applied> {
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

async function applyEntry(p: Extract<Proposal, { kind: 'entry' }>): Promise<Applied> {
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

async function applyNewEntry(p: Extract<Proposal, { kind: 'newEntry' }>): Promise<Applied> {
  const storyId = useApp.getState().storyId
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

async function applyNewScene(p: Extract<Proposal, { kind: 'newScene' }>): Promise<Applied> {
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

async function applyNewChapter(p: Extract<Proposal, { kind: 'newChapter' }>): Promise<Applied> {
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

async function applyRename(p: Extract<Proposal, { kind: 'rename' }>): Promise<Applied> {
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

/** A paragraph's words as inline content: *asterisks* become italics. */
function inline(schema: Schema, text: string): PMNode[] {
  const out: PMNode[] = []
  const italic = schema.marks.italic
  for (const part of text.split(/(\*[^*\n]+\*)/)) {
    if (!part) continue
    const it = /^\*([^*\n]+)\*$/.exec(part)
    if (it && italic) out.push(schema.text(it[1], [italic.create()]))
    else out.push(schema.text(part.replace(/\*/g, '')))
  }
  return out
}

/**
 * A passage rewritten across paragraphs: from its start words to its end words becomes the new paragraphs, in one
 * step (a snapshot first; Ctrl+Z or Undo takes it back). The words before the start and after the end in their
 * paragraphs stay, joined to the first and last new paragraph.
 */
async function applyPassage(p: Extract<Proposal, { kind: 'passage' }>): Promise<Applied> {
  const editor = await sceneInPage(p.sceneId)
  if (!editor) return { ok: false, why: `${p.sceneLabel} couldn’t be opened.` }
  if (editorBridge()?.busy()) return { ok: false, why: 'A draft is being written into this scene. Wait for it to finish, then apply.' }
  const doc = editor.state.doc
  const start = findTextRange(doc, p.start)
  const end = start ? findTextRangeAfter(doc, p.end, start.from) : null
  if (!start || !end) {
    return { ok: false, why: 'The words this change looks for aren’t in the scene any more: another change or your own editing changed them. Ask again for a fresh one.' }
  }
  await snapshotBefore(p.sceneId, 'Before an edit from Ask the world')
  const $a = doc.resolve(start.from)
  const $b = doc.resolve(end.to)
  const schema = editor.schema
  const texts = p.replace
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
  const last = texts.length - 1
  const nodes = texts.map((t, i) => {
    let content = Fragment.from(inline(schema, t))
    if (i === 0) content = $a.parent.content.cut(0, $a.parentOffset).append(content)
    if (i === last) content = content.append($b.parent.content.cut($b.parentOffset))
    // The first keeps its paragraph's id; the rest get fresh ones (paragraphIds.ts).
    const attrs = i === 0 ? $a.parent.attrs : { ...$a.parent.attrs, pid: null }
    return $a.parent.type.create(attrs, content)
  })
  const from = $a.before($a.depth)
  const to = $b.after($b.depth)
  editor
    .chain()
    .command(({ tr }) => {
      tr.replaceWith(from, to, nodes)
      return true
    })
    .run()
  return {
    ok: true,
    undo: async () => {
      const b = editorBridge()
      if (b?.sceneId === p.sceneId) b.undo()
    }
  }
}

/** Carries out one proposed change. Never throws: a problem comes back in plain words. */
export async function applyProposal(p: Proposal): Promise<Applied> {
  try {
    switch (p.kind) {
      case 'text':
        return await applyText(p)
      case 'passage':
        return await applyPassage(p)
      case 'card':
        return await applyCard(p)
      case 'entry':
        return await applyEntry(p)
      case 'newEntry':
        return await applyNewEntry(p)
      case 'newScene':
        return await applyNewScene(p)
      case 'newChapter':
        return await applyNewChapter(p)
      case 'rename':
        return await applyRename(p)
    }
  } catch (e) {
    return { ok: false, why: (e as Error)?.message || 'That change couldn’t be applied.' }
  }
}

/** What applying a set of changes did, and Undo for all of them (latest first). */
async function applyAndKeep(generationId: ID, list: Proposal[]): Promise<{ done: number; undos: (() => Promise<void>)[]; failed: string[] }> {
  const undos: (() => Promise<void>)[] = []
  const failed: string[] = []
  for (const p of list) {
    const r = await applyProposal(p)
    if (r.ok) {
      undos.push(async () => {
        await r.undo()
        await setProposalStatus(generationId, p.id, 'pending')
      })
      await setProposalStatus(generationId, p.id, 'applied')
    } else failed.push(r.why)
  }
  return { done: undos.length, undos, failed }
}

/** Applies the changes picked (one, or every one still waiting with Apply all), says how it went, and offers Undo. */
export async function applyChanges(generationId: ID, list: Proposal[]): Promise<void> {
  const { done, undos, failed } = await applyAndKeep(generationId, list)
  if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} changes couldn’t be applied. ${failed[0]}`, { tone: 'danger' })
  if (!done) return
  toast(done === 1 ? 'Change applied.' : `${done} changes applied.`, {
    tone: 'success',
    action: {
      label: 'Undo',
      run: () => {
        void (async () => {
          for (const u of undos.reverse()) await u().catch(() => undefined)
        })()
      }
    }
  })
}

/** Not this: the change is set aside (it can still be applied later). */
export const declineChange = (generationId: ID, p: Proposal, status: ProposalStatus = 'declined'): Promise<void> =>
  setProposalStatus(generationId, p.id, status)
