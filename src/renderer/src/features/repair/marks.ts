// The slips mended as new AI words landed (check and repair; repairRun.ts), shown in the page in the AI's amber: a
// TipTap extension in the editor's list (features/editor/extensions.ts). The marks live in this plugin's state, never
// in the document, so autosave, snapshots and the memory only see the scene's own words. Each is mapped through every
// change; Adam editing inside it, or the whole scene being replaced, takes it away, and opening another scene builds a
// new editor state, so they go then too. Hovering one says what the AI had written there and why it was changed.
//
// Undo and redo keep the fixes and their issues straight (repairRun.ts listens: onRepairHistory). A fix taken back,
// by the message's Undo or by Ctrl+Z, holds the AI's words again and waits in `undone`; Ctrl+Z taking it back says so
// (the page marks its issue ignored, as the message's Undo does: Adam didn't want the change). Ctrl+Y, or Ctrl+Z after
// the message's Undo, brings the fix back in amber and says so (its issue is fixed again). A change marked `quiet`
// (Beat by beat taking a beat out to write it again) takes fixes away without a word.
//
// It also notes the paragraphs Adam types in while a draft or beat streams into the page (`typed`, by paragraph id,
// since the stream began): their words aren't all the AI's, so nothing in them is ever mended.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { isHistoryTransaction } from '@tiptap/pm/history'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { mapRange } from '@/features/edits/suggestions'
import { activeStream, streamKey } from '@/features/editor/streamDoc'
import { changeKind } from '@/features/goals/wordTally'
import type { MadeFix } from './apply'
import './repair.css'

/** A fix shown in the page, and the landing it came with (so Undo takes back that landing's fixes). */
export interface RepairMark extends MadeFix {
  landing: string
}

/** What the last undo or redo did to fixes: taken back (`undone`), or brought back (`redone`), by fix id. */
export interface RepairHistory {
  seq: number
  undone: string[]
  redone: string[]
}

interface RepairMarksState {
  marks: RepairMark[]
  /** Fixes taken back, their places now holding the AI's words (`was`), until a redo brings them back. */
  undone: RepairMark[]
  /** Paragraph ids Adam typed in while a draft streamed into the page (since that stream began). */
  typed: string[]
  history: RepairHistory | null
}

type Meta = { type: 'add'; marks: RepairMark[] } | { type: 'remove'; ids: string[] } | { type: 'quiet' }

export const repairKey = new PluginKey<RepairMarksState>('aiwriteRepairs')

const MOST_UNDONE = 50
const MOST_TYPED = 400
let historySeq = 0

const quoted = (s: string): string => `“${s}”`

/** The ids of the paragraphs a change touched, in the document after it. */
function touchedPids(tr: Transaction): string[] {
  const out = new Set<string>()
  const doc = tr.doc
  tr.mapping.maps.forEach((map, i) => {
    const after = tr.mapping.slice(i + 1)
    map.forEach((_s, _e, ns, ne) => {
      const a = Math.max(0, Math.min(after.map(ns, -1), doc.content.size))
      const b = Math.max(a, Math.min(after.map(ne, 1), doc.content.size))
      const at = doc.resolve(a).parent
      if (at.isTextblock && typeof at.attrs.pid === 'string') out.add(at.attrs.pid)
      doc.nodesBetween(a, b, (node) => {
        if (!node.isTextblock) return true
        if (typeof node.attrs.pid === 'string') out.add(node.attrs.pid)
        return false
      })
    })
  })
  return [...out]
}

function apply(tr: Transaction, value: RepairMarksState, before: EditorState): RepairMarksState {
  const meta = tr.getMeta(repairKey) as Meta | undefined
  const quiet = meta?.type === 'quiet'
  const removing = meta?.type === 'remove' ? meta.ids : []
  let { marks, undone, typed } = value
  let history = value.history
  if (tr.docChanged) {
    const doc = tr.doc
    const holds = (from: number, text: string): boolean =>
      from >= 0 && from + text.length <= doc.content.size && doc.textBetween(from, from + text.length, '\n', '\n') === text
    const byHistory = isHistoryTransaction(tr) && !quiet
    const nextMarks: RepairMark[] = []
    const nextUndone: RepairMark[] = []
    const taken: string[] = []
    const back: string[] = []
    for (const m of marks) {
      const from = tr.mapping.map(m.from, -1)
      // The message's Undo: the AI's words are back, and the fix waits for a redo.
      if (removing.includes(m.id)) {
        if (holds(from, m.was)) nextUndone.push({ ...m, from, to: from + m.was.length })
        continue
      }
      const r = mapRange(m, tr)
      if (typeof r !== 'string' && r.to > r.from) nextMarks.push({ ...m, ...r })
      else if (byHistory && holds(from, m.was)) {
        // Ctrl+Z took the fix back.
        nextUndone.push({ ...m, from, to: from + m.was.length })
        taken.push(m.id)
      }
    }
    for (const u of undone) {
      const r = mapRange(u, tr)
      if (typeof r !== 'string' && r.to > r.from) {
        nextUndone.push({ ...u, ...r })
        continue
      }
      const from = tr.mapping.map(u.from, -1)
      // Ctrl+Y (or Ctrl+Z after the message's Undo) brought the fix back.
      if (byHistory && holds(from, u.now)) {
        nextMarks.push({ ...u, from, to: from + u.now.length })
        back.push(u.id)
      }
    }
    marks = nextMarks
    undone = nextUndone.slice(-MOST_UNDONE)
    if (taken.length || back.length) history = { seq: ++historySeq, undone: taken, redone: back }
  } else if (removing.length) marks = marks.filter((m) => !removing.includes(m.id))
  if (meta?.type === 'add') marks = [...marks.filter((m) => !meta.marks.some((x) => x.id === m.id)), ...meta.marks]

  // Adam's own typing (or undoing it) while a draft streams in: the paragraphs he touched aren't all the AI's.
  if ((tr.getMeta(streamKey) as { type?: string } | undefined)?.type === 'start') typed = []
  if (tr.docChanged && activeStream(before)) {
    const kind = changeKind(tr)
    if (kind === 'typed' || kind === 'history') {
      const add = touchedPids(tr).filter((id) => !typed.includes(id))
      if (add.length) typed = [...typed, ...add].slice(-MOST_TYPED)
    }
  }
  return marks === value.marks && undone === value.undone && typed === value.typed && history === value.history ? value : { marks, undone, typed, history }
}

/** Who hears what an undo or redo did to fixes (repairRun.ts keeps their issues right). */
const listeners = new Set<(h: RepairHistory) => void>()
export function onRepairHistory(fn: (h: RepairHistory) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const plugin = new Plugin<RepairMarksState>({
  key: repairKey,
  state: {
    init: () => ({ marks: [], undone: [], typed: [], history: null }),
    apply: (tr, value, before) => apply(tr, value, before)
  },
  view: () => ({
    update(view, prev) {
      const now = repairKey.getState(view.state)?.history
      if (!now || now === repairKey.getState(prev)?.history) return
      for (const fn of listeners) {
        try {
          fn(now)
        } catch (e) {
          console.warn('A fix’s undo could not be noted', e)
        }
      }
    }
  }),
  props: {
    decorations(state) {
      const marks = repairKey.getState(state)?.marks ?? []
      if (!marks.length) return null
      return DecorationSet.create(
        state.doc,
        marks.map((m) =>
          Decoration.inline(m.from, m.to, {
            class: 'aw-repair',
            'data-repair-fix': m.id,
            title: `Mended as the new words landed: the AI had written ${quoted(m.was)}. ${m.why}`.trim()
          })
        )
      )
    }
  }
})

/** The fixes shown in the page now. */
export const repairMarks = (state: EditorState): RepairMark[] => repairKey.getState(state)?.marks ?? []

/** The ids of the paragraphs Adam typed in while the latest draft streamed in. */
export const typedWhileStreaming = (state: EditorState): Set<string> => new Set(repairKey.getState(state)?.typed ?? [])

/** Shows these fixes in the page (set on the transaction that makes them). */
export const addRepairMarks = (tr: Transaction, marks: RepairMark[]): Transaction => tr.setMeta(repairKey, { type: 'add', marks } satisfies Meta)

/** The message's Undo: these fixes are taken back (set on the transaction that puts the AI's words back). */
export const removeRepairMarks = (tr: Transaction, ids: string[]): Transaction => tr.setMeta(repairKey, { type: 'remove', ids } satisfies Meta)

/** A change that takes fixes away without it being Adam's undo (Beat by beat taking a beat out to write it again). */
export const quietRepairs = (tr: Transaction): Transaction => tr.setMeta(repairKey, { type: 'quiet' } satisfies Meta)

/** For tests: the plugin on its own. */
export const repairPluginForTests = plugin

export const RepairMarks = Extension.create({
  name: 'aiwriteRepairMarks',
  addProseMirrorPlugins: () => [plugin]
})
