// The slips mended as new AI words landed (check and repair; repairRun.ts), shown in the page in the AI's amber: a
// TipTap extension in the editor's list (features/editor/extensions.ts). The marks live in this plugin's state, never
// in the document, so autosave, snapshots and the memory only see the scene's own words. Each is mapped through every
// change; an edit inside it (Adam's typing, Ctrl+Z taking the fix back) or the whole scene being replaced takes it
// away, and opening another scene builds a new editor state, so they go then too. Hovering one says what the AI had
// written there and why it was changed.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { mapRange } from '@/features/edits/suggestions'
import type { MadeFix } from './apply'
import './repair.css'

/** A fix shown in the page, and the landing it came with (so Undo takes back that landing's fixes). */
export interface RepairMark extends MadeFix {
  landing: string
}

interface RepairMarksState {
  marks: RepairMark[]
}

type Meta = { type: 'add'; marks: RepairMark[] } | { type: 'remove'; ids: string[] }

export const repairKey = new PluginKey<RepairMarksState>('aiwriteRepairs')

const quoted = (s: string): string => `“${s}”`

function apply(tr: Transaction, value: RepairMarksState): RepairMarksState {
  const meta = tr.getMeta(repairKey) as Meta | undefined
  let marks = value.marks
  if (tr.docChanged && marks.length) {
    const next: RepairMark[] = []
    for (const m of marks) {
      const r = mapRange(m, tr)
      if (typeof r !== 'string' && r.to > r.from) next.push({ ...m, ...r })
    }
    marks = next
  }
  if (meta?.type === 'add') marks = [...marks.filter((m) => !meta.marks.some((x) => x.id === m.id)), ...meta.marks]
  if (meta?.type === 'remove') marks = marks.filter((m) => !meta.ids.includes(m.id))
  return marks === value.marks ? value : { marks }
}

const plugin = new Plugin<RepairMarksState>({
  key: repairKey,
  state: {
    init: () => ({ marks: [] }),
    apply
  },
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

/** Shows these fixes in the page (set on the transaction that makes them). */
export const addRepairMarks = (tr: Transaction, marks: RepairMark[]): Transaction => tr.setMeta(repairKey, { type: 'add', marks } satisfies Meta)

/** Stops showing these fixes. */
export const removeRepairMarks = (tr: Transaction, ids: string[]): Transaction => tr.setMeta(repairKey, { type: 'remove', ids } satisfies Meta)

export const RepairMarks = Extension.create({
  name: 'aiwriteRepairMarks',
  addProseMirrorPlugins: () => [plugin]
})
