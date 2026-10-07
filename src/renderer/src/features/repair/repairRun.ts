// Check and repair in the page (step 3 of the consistency plan, Adam, 2026-10-07; contracts/repair.ts). As soon as a
// draft, Add below, a beat or Continue lands (and a polished draft Adam accepts), its words go to the memory model to
// be checked claim by claim against where things stood. What comes back:
//   - small slips are mended in place: tiny edits of the AI's own words, all in one undo step, shown in amber
//     (marks.ts), with Undo in a message (it puts the AI's words back, and that slip is never mended again);
//   - anything that needs Adam's choice is a question in the Issues tab, and a message says so.
// Only the words that just landed are ever changed, and only while their paragraph is as it landed: a paragraph Adam
// has typed in since, or one his cursor is in the words of, is left alone, and its slip is asked as a question
// instead. His cursor and typing are never moved or lost (apply.ts). Nothing is said when nothing was found.
import type { RepairFix } from '@shared/contracts/repair'
import type { ID } from '@shared/types'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { activeStream, sceneText } from '@/features/editor/streamDoc'
import { activeSuggestion } from '@/features/edits/suggestions'
import { WORDS_META } from '@/features/goals/wordsMeta'
import { showIssues } from '@/features/issues/issuesStore'
import { fixesTr, landedParts, undoFixesTr, type LandedPart, type MadeFix } from './apply'
import { addRepairMarks, onRepairHistory, removeRepairMarks, repairMarks, typedWhileStreaming, type RepairMark } from './marks'

/** New AI words that just landed in the page: positions `from` to `to` of the scene showing. */
export interface Landing {
  sceneId: ID
  /** The record of the AI's words (only its words are mended). */
  recordId: ID
  /** Whose stage to compare with, when not the record's own (a polished draft: the draft's). */
  stageOf?: ID
  from: number
  to: number
}

/** How much of the scene before the new words goes with them, for what leads in. */
const LEAD_IN = 1_500
/** How long mending waits for a word being composed (an accent, an IME) to be finished. */
const COMPOSING_WAIT_MS = 3_000

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const newId = (): ID => globalThis.crypto.randomUUID()

// ---------- Each fix's issue ----------
// A fix made is kept as a fixed issue (the main process says its id once it has it). Taken back (the message's Undo, or
// Ctrl+Z) it is marked ignored: Adam didn't want that change, so it isn't made or asked again. Brought back (Ctrl+Y,
// or Ctrl+Z after the message's Undo) it is fixed again. What an undo asks before the id is known waits for it.

const issueOf = new Map<ID, ID>()
const wanted = new Map<ID, 'ignored' | 'fixed'>()
const MOST_KEPT = 300

function keep<K, V>(m: Map<K, V>, k: K, v: V): void {
  m.delete(k)
  m.set(k, v)
  while (m.size > MOST_KEPT) m.delete(m.keys().next().value as K)
}

function fixStatus(fixId: ID, status: 'ignored' | 'fixed'): void {
  const id = issueOf.get(fixId)
  if (!id) return keep(wanted, fixId, status)
  void (status === 'ignored' ? api.ignoreIssue(id) : api.markIssueFixed(id)).catch(() => undefined)
}

onRepairHistory((h) => {
  for (const id of h.undone) fixStatus(id, 'ignored')
  for (const id of h.redone) fixStatus(id, 'fixed')
})

/** The main process kept the fixes made as issues: each one's id, and what an undo asked of it meanwhile. */
function issuesKept(ids: Record<ID, ID>): void {
  for (const [fixId, issueId] of Object.entries(ids)) {
    keep(issueOf, fixId, issueId)
    const w = wanted.get(fixId)
    wanted.delete(fixId)
    if (w === 'ignored') fixStatus(fixId, w)
  }
}

/** Who hears that fixes went into a landing's words (Beat by beat: its "Write it again" takes them out with the beat). */
const repairedHooks = new Set<(recordId: ID, before: EditorState, after: EditorState) => void>()
export function onRepaired(fn: (recordId: ID, before: EditorState, after: EditorState) => void): () => void {
  repairedHooks.add(fn)
  return () => repairedHooks.delete(fn)
}

/** Checks new words that just landed, in the background. Never throws; says nothing when nothing was found. */
export function repairLanded(l: Landing): void {
  void run(l).catch((e) => console.warn('Could not check the new words', e))
}

async function run(l: Landing): Promise<void> {
  // Adam's switch (Settings › Models, "Check new words straight away"): off, nothing is checked.
  if (useApp.getState().settings?.checkNewWords === false) return
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!bridge || !ed || ed.isDestroyed || bridge.sceneId !== l.sceneId) return
  const doc = ed.state.doc
  const to = Math.min(l.to, doc.content.size)
  // Paragraphs Adam typed in while the words streamed in are marked: nothing in them is mended.
  const parts = landedParts(doc, Math.max(0, l.from), to, typedWhileStreaming(ed.state))
  if (!parts.length) return
  const before = sceneText(doc.cut(0, Math.max(0, l.from)))
  const leadIn = before.slice(-LEAD_IN)
  // Saved first: a question raised on words the saved scene doesn't have yet would be put away as gone.
  await bridge.flush().catch(() => undefined)
  const outcome = await api.checkNewWords({
    sceneId: l.sceneId,
    recordId: l.recordId,
    ...(l.stageOf ? { stageOf: l.stageOf } : {}),
    paragraphs: parts.map(({ text, from, to, edited }) => ({ text, from, to, ...(edited ? { edited } : {}) })),
    leadIn,
    beforeChars: before.length
  })
  if (!outcome.repairId) return
  const landing = newId()
  const made = outcome.fixes.length ? await mend(l, parts, outcome.fixes, landing) : []
  if (outcome.fixes.length) issuesKept(await api.repairsApplied(outcome.repairId, made.map((m) => m.id)).catch(() => ({}) as Record<ID, ID>))
  tell(l.sceneId, landing, made, outcome.fixes.length - made.length + outcome.questions)
}

/** Makes the fixes that can be made now, in one undo step of their own, shown in amber. */
async function mend(l: Landing, parts: LandedPart[], fixes: RepairFix[], landing: ID): Promise<MadeFix[]> {
  const until = Date.now() + COMPOSING_WAIT_MS
  for (;;) {
    const bridge = editorBridge()
    const ed = bridge?.editor
    if (!bridge || !ed || ed.isDestroyed || bridge.sceneId !== l.sceneId) return []
    // A word being composed is finished first (changing the page under it would break it).
    if (ed.view.composing && Date.now() < until) {
      await wait(100)
      continue
    }
    if (ed.view.composing) return []
    const state = ed.state
    const stream = activeStream(state)
    const waiting = activeSuggestion(state)
    // Not inside a draft being written, nor under an AI change waiting for Accept.
    const blocked = (from: number, to: number): boolean =>
      (!!stream && to > stream.from) || (!!waiting && from <= Math.max(waiting.from, waiting.to) && to >= Math.min(waiting.from, waiting.to))
    const got = fixesTr(state, parts, fixes, blocked)
    if (!got) return []
    const marks: RepairMark[] = got.made.map((m) => ({ ...m, landing }))
    ed.view.dispatch(addRepairMarks(closeHistory(got.tr), marks).setMeta(WORDS_META, 'ai-net'))
    // Typing straight after is a step of its own.
    ed.view.dispatch(closeHistory(ed.state.tr))
    for (const fn of repairedHooks) {
      try {
        fn(l.recordId, state, ed.state)
      } catch (e) {
        console.warn('Could not note the fixes', e)
      }
    }
    return got.made
  }
}

const sentence = (s: string): string => {
  const t = s.trim()
  return !t || /[.!?]["”’']?$/.test(t) ? t : `${t}.`
}

/** Says what was mended (with Undo) and what is asked. */
function tell(sceneId: ID, landing: ID, made: MadeFix[], asked: number): void {
  const show = { label: 'Show', run: () => void showIssues(sceneId) }
  const questions = asked === 1 ? 'A question about them is in the Issues tab.' : `${asked} questions about them are in the Issues tab.`
  if (made.length) {
    const what = made.length === 1 ? `Mended a slip in the new words, in amber: ${sentence(made[0].why)}` : `Mended ${made.length} slips in the new words, in amber.`
    toast(asked ? `${what} ${questions}` : what, {
      action: { label: 'Undo', run: () => undo(sceneId, landing) },
      ...(asked ? { secondary: show } : {})
    })
    return
  }
  if (asked) toast(asked === 1 ? 'A question about the new words is in the Issues tab.' : `${asked} questions about the new words are in the Issues tab.`, { action: show })
}

/** Undo: the AI's words back where the fixes still stand as made, and those slips are never mended or asked again. */
function undo(sceneId: ID, landing: ID): void {
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!bridge || !ed || ed.isDestroyed || bridge.sceneId !== sceneId) {
    toast('Open the scene to put the words back.')
    return
  }
  const marks = repairMarks(ed.state).filter((m) => m.landing === landing)
  const tr = marks.length ? undoFixesTr(ed.state, marks) : null
  if (!tr) {
    toast('Those words have changed since, so there is nothing to put back.')
    return
  }
  ed.view.dispatch(removeRepairMarks(closeHistory(tr), marks.map((m) => m.id)).setMeta(WORDS_META, 'ai-net'))
  ed.view.dispatch(closeHistory(ed.state.tr))
  for (const m of marks) fixStatus(m.id, 'ignored')
  toast(marks.length === 1 ? 'Put back as the AI wrote it. It won’t be changed again.' : 'Put back as the AI wrote them. They won’t be changed again.')
}
