// Each draft's one note (the calm overhaul; the words are compose.ts's). The draft (generate/draftRun.ts), check and
// repair as its words land (repair/repairRun.ts), the live checks' count of phrases it brought (liveChecks/liveActions.ts)
// and the check a little after it (issues/issuesStore.ts) each add what they have to say to the scene's note, which
// shows once and changes in place as more comes (every change gives it its full time again). A note that has gone is
// shown again only with news, and then only with the news. Landings that aren't a Generate draft (Continue, a beat, a
// rewrite accepted) keep their own messages: the add functions say false for them.
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { composeDraftNote, type DraftEnd, type DraftNoteParts, type NoteButton } from './compose'

/** A note is about its draft for this long after the draft ends (later news is a note of its own). */
const FRESH_MS = 5 * 60_000
/** The phrases underlined count as the draft's for this long after it ends (the live checks count them a moment later). */
const PHRASES_MS = 30_000

type Handler = { label: string; run: () => void }

interface Note {
  sceneId: ID
  generationId: ID | null
  parts: DraftNoteParts
  handlers: Partial<Record<NoteButton, Handler>>
  /** When the draft ended (null while it writes). */
  endedAt: number | null
  toastId: number | null
  /** What the note has said already, so a note shown again says only the news. */
  shown: Set<keyof DraftNoteParts>
}

const notes = new Map<ID, Note>()

const showing = (n: Note): boolean => n.toastId !== null && useToasts.getState().items.some((t) => t.id === n.toastId)

/** The scene's note while it is about the draft being written or one that ended a moment ago. */
function current(sceneId: ID, within = FRESH_MS): Note | null {
  const n = notes.get(sceneId)
  if (!n) return null
  if (n.endedAt !== null && Date.now() - n.endedAt > within && !showing(n)) return null
  return n
}

/** A draft of the scene started: its note begins (an older one's message, if it still shows, is left to go by itself). */
export function beginDraftNote(sceneId: ID, generationId: ID | null): void {
  notes.set(sceneId, { sceneId, generationId, parts: { end: null, away: null }, handlers: {}, endedAt: null, toastId: null, shown: new Set() })
  // The few kept are those of the last scenes drafted.
  for (const k of [...notes.keys()].slice(0, Math.max(0, notes.size - 8))) notes.delete(k)
}

/** The draft's record is known now (it was being got ready). */
export function draftNoteRecord(sceneId: ID, generationId: ID): void {
  const n = notes.get(sceneId)
  if (n) n.generationId = generationId
}

/** Something to know about how the draft was briefed: said at once, and kept in the note. */
export function noteDraftStart(sceneId: ID, startNote: string): void {
  const n = notes.get(sceneId)
  if (!n) return void toast(startNote)
  n.parts = { ...n.parts, startNote }
  render(n)
}

/** How the draft ended, with where it was written and the buttons' work. */
export function noteDraftEnd(
  sceneId: ID,
  end: DraftEnd,
  o: { away: string | null; oldText?: string; fixes?: DraftNoteParts['fixes']; retryWith?: string | null; handlers: Partial<Record<NoteButton, Handler>> }
): void {
  const n = notes.get(sceneId) ?? (beginDraftNote(sceneId, null), notes.get(sceneId)!)
  n.parts = { ...n.parts, end, away: o.away, oldText: o.oldText, fixes: o.fixes, retryWith: o.retryWith }
  n.handlers = { ...n.handlers, ...o.handlers }
  n.endedAt = Date.now()
  render(n)
}

/**
 * Check and repair's outcome for new words that landed (repairRun.ts): added to the draft's note when the words are its
 * draft's (`recordId`). False when they aren't a draft's (the caller says it its own way).
 */
export function noteDraftRepair(sceneId: ID, recordId: ID, r: { mended: number; why: string | null; questions: number; undo: () => void; show: () => void }): boolean {
  const n = current(sceneId)
  if (!n || n.generationId !== recordId) return false
  n.parts = {
    ...n.parts,
    mended: r.mended ? { count: (n.parts.mended?.count ?? 0) + r.mended, why: r.why } : n.parts.mended,
    questions: (n.parts.questions ?? 0) + r.questions
  }
  n.handlers = { ...n.handlers, undo: { label: 'Undo', run: r.undo }, issues: { label: 'Show', run: r.show } }
  if (r.mended) n.shown.delete('mended')
  if (r.questions) n.shown.delete('questions')
  render(n)
  return true
}

/** Phrases to avoid and common AI phrases a draft brought (the live checks count them as it lands). False: not a draft's. */
export function noteDraftPhrases(sceneId: ID, counts: { phrase: number; ai: number }, reveal: () => void): boolean {
  const n = current(sceneId, PHRASES_MS)
  if (!n || n.endedAt === null) return false
  const was = n.parts.phrases ?? { phrase: 0, ai: 0 }
  n.parts = { ...n.parts, phrases: { phrase: was.phrase + counts.phrase, ai: was.ai + counts.ai } }
  n.handlers = { ...n.handlers, phrases: { label: 'Show', run: reveal } }
  n.shown.delete('phrases')
  render(n)
  return true
}

/** What the check a little after a draft found (issuesStore.ts): in the draft's note, or a note of its own. */
export function noteDraftCheck(sceneId: ID, found: number): void {
  const show = { label: 'Show', run: () => void import('@/features/issues/issuesStore').then((m) => m.showIssues(sceneId)) }
  const n = current(sceneId)
  if (!n || n.endedAt === null) {
    toast(found === 1 ? 'The check after the draft found 1 thing to look at.' : `The check after the draft found ${found} things to look at.`, { action: show })
    return
  }
  n.parts = { ...n.parts, checkFound: (n.parts.checkFound ?? 0) + found }
  n.handlers = { ...n.handlers, issues: n.handlers.issues ?? show }
  n.shown.delete('checkFound')
  render(n)
}

/** Shows the note, or changes it in place; a note that went is shown again only with news. */
function render(n: Note): void {
  const live = showing(n)
  // Shown again: only what it hasn't said yet (how the draft ended is always said, for what the news is about).
  const parts: DraftNoteParts = live
    ? n.parts
    : {
        ...n.parts,
        startNote: n.shown.has('startNote') ? null : n.parts.startNote,
        mended: n.shown.has('mended') ? undefined : n.parts.mended,
        questions: n.shown.has('questions') ? 0 : n.parts.questions,
        checkFound: n.shown.has('checkFound') ? 0 : n.parts.checkFound,
        phrases: n.shown.has('phrases') ? undefined : n.parts.phrases,
        oldText: n.shown.has('oldText') ? undefined : n.parts.oldText
      }
  const note = composeDraftNote(parts)
  if (!note) return
  const [first, second] = note.buttons.map((b) => n.handlers[b]).filter((h): h is Handler => !!h)
  const input = { message: note.message, tone: note.tone, action: first, secondary: second }
  if (live && n.toastId !== null) useToasts.getState().update(n.toastId, input)
  else {
    // Not the same news again: a note that went is shown again only when something new came.
    if (!live && n.toastId !== null && !hasNews(n)) return
    n.toastId = toast(input.message, { tone: input.tone, action: input.action, secondary: input.secondary })
  }
  for (const k of ['startNote', 'mended', 'questions', 'checkFound', 'phrases', 'oldText', 'end'] as const) if (n.parts[k]) n.shown.add(k)
}

/** Something the note hasn't said yet. */
function hasNews(n: Note): boolean {
  const p = n.parts
  return (
    (!!p.mended?.count && !n.shown.has('mended')) ||
    (!!p.questions && !n.shown.has('questions')) ||
    (!!p.checkFound && !n.shown.has('checkFound')) ||
    (!!p.phrases && p.phrases.phrase + p.phrases.ai > 0 && !n.shown.has('phrases')) ||
    (!!p.end && !n.shown.has('end'))
  )
}

/** For tests: forget every note. */
export function resetDraftNotes(): void {
  notes.clear()
}
