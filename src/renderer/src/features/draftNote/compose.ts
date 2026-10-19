// One note per draft (the calm overhaul, 2026-10-19: one draft could bring three or four messages, one after another:
// how it ended, the slips mended in amber, the questions asked, the phrases underlined, what the check after it found).
// Everything a draft has to say goes in one note, in one line: "Draft written · 2 small slips fixed in amber · 1 question
// in Issues". Later news changes the same note. Its two buttons are the ones that matter most, in order: Try again with
// another model (a refusal), the fix for a problem, Undo for the amber fixes, the Issues list, the first phrase, the
// scene. A draft written here with nothing else to say says nothing: the page shows it. Pure, so it is unit-tested;
// draftNote.ts keeps each scene's note and shows it.
import type { ModelChoice } from '@shared/types'

/** How a draft ended, as the note tells it. */
export type DraftEnd =
  | { kind: 'written'; stopped?: boolean; unpolished?: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'refused'; message: string | null }
  | { kind: 'cutOff' }

/** A button on the note. */
export type NoteButton = 'retry' | 'options' | 'settings' | 'continue' | 'record' | 'undo' | 'issues' | 'phrases' | 'scene'

export interface DraftNoteParts {
  /** How it ended; null while it is still being written (only what it said as it started is known). */
  end: DraftEnd | null
  /** It ended in a scene Adam had left: the scene's title in quotes ("“The Ferry”"). Null: the scene on screen. */
  away: string | null
  /** The draft took the place of the scene's text: how to have it back ("Ctrl+Z puts the scene's old text back."). */
  oldText?: string
  /** Something to know about how it was briefed (written without where things stood, say). */
  startNote?: string | null
  /** Small slips mended in amber in its words, and the one reason when there was one. */
  mended?: { count: number; why: string | null }
  /** Questions about its words in the Issues list. */
  questions?: number
  /** What the check a little after it found, in the Issues list. */
  checkFound?: number
  /** Phrases to avoid and common AI phrases underlined in it. */
  phrases?: { phrase: number; ai: number }
  /** For a refusal: another of Adam's models to try again with (its name), or null when he has no other. */
  retryWith?: string | null
  /** For a problem: the buttons that go where its fix is (generate/draftEnd.ts draftEndActions). */
  fixes?: ('options' | 'settings' | 'continue' | 'record')[]
}

export interface ComposedNote {
  message: string
  tone: 'neutral' | 'danger'
  /** The main button, then the second (at most two). */
  buttons: NoteButton[]
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

const sentence = (s: string): string => {
  const t = s.trim()
  return !t || /[.!?…]["”’']?$/.test(t) ? t : `${t}.`
}

/** The note's first words: how the draft ended. Null while it writes. */
function head(p: DraftNoteParts): string | null {
  const e = p.end
  if (!e) return null
  const scene = p.away
  switch (e.kind) {
    case 'written':
      if (e.stopped) return scene ? `Drafting ${scene} stopped · the text so far is kept` : 'Draft stopped · the text so far is kept'
      if (scene && e.unpolished) return `Draft of ${scene} written · not polished, as you were in another scene when it finished`
      return scene ? `Draft of ${scene} written` : 'Draft written'
    case 'cutOff':
      return `The model ran out of room before the end of ${scene ?? 'the scene'}, so the draft stops mid-way. The text so far is kept. Try a shorter target length, or a writer model that can write more in one go`
    case 'refused':
      return e.message?.trim() ? e.message.trim().replace(/[.]$/, '') : `The writer model turned ${scene ?? 'this scene'} down`
    case 'error':
      return `${scene ? `The draft of ${scene} ran into a problem. ` : ''}${e.message.trim().replace(/[.]$/, '')}`
  }
}

/** What else there is to say, each a few words. */
function news(p: DraftNoteParts): string[] {
  const out: string[] = []
  if (p.mended && p.mended.count > 0) out.push(plural(p.mended.count, 'small slip fixed in amber', 'small slips fixed in amber'))
  if (p.questions) out.push(plural(p.questions, 'question in Issues', 'questions in Issues'))
  if (p.checkFound) out.push(p.questions ? plural(p.checkFound, 'more thing to look at', 'more things to look at') : plural(p.checkFound, 'thing to look at in Issues', 'things to look at in Issues'))
  const ph = p.phrases
  if (ph && ph.phrase + ph.ai > 0) {
    const parts: string[] = []
    if (ph.phrase > 0) parts.push(plural(ph.phrase, 'phrase to avoid', 'phrases to avoid'))
    if (ph.ai > 0) parts.push(plural(ph.ai, 'common AI phrase', 'common AI phrases'))
    out.push(`${parts.join(' and ')} underlined`)
  }
  return out
}

/**
 * The one note for a draft, or null when there is nothing to say (written in the scene on screen, nothing found).
 */
export function composeDraftNote(p: DraftNoteParts): ComposedNote | null {
  const first = head(p)
  const more = news(p)
  const problem = p.end?.kind === 'error' || p.end?.kind === 'refused'
  const quietEnd = p.end?.kind === 'written' && !p.away
  // A draft written here, with nothing found and nothing to tell: the page shows it.
  if (!more.length && !p.startNote && (quietEnd || !p.end)) return null
  let message: string
  if (first && !problem && p.end?.kind !== 'cutOff') {
    message = [first, ...more].join(' · ')
  } else if (first) {
    // A problem says itself in full; anything else found comes after it.
    message = more.length ? `${sentence(first)} ${upper(more.join(' · '))}` : first
  } else {
    // Still writing (or a landing with no draft's end): what was found, on its own.
    message = upper(more.join(' · '))
  }
  const after = [p.startNote, p.end && (p.end.kind === 'written' || p.end.kind === 'cutOff' || problem) ? p.oldText : null].filter((s): s is string => !!s?.trim())
  message = after.length ? [sentence(message), ...after.map(sentence)].filter(Boolean).join(' ') : message
  return { message, tone: problem ? 'danger' : 'neutral', buttons: buttonsOf(p) }
}

const upper = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The note's buttons, the one that matters most first (at most two). */
function buttonsOf(p: DraftNoteParts): NoteButton[] {
  const out: NoteButton[] = []
  const add = (b: NoteButton | null | false | undefined): void => {
    if (b && !out.includes(b) && out.length < 2) out.push(b)
  }
  if (p.end?.kind === 'refused') {
    add(p.retryWith ? 'retry' : 'settings')
    add(p.retryWith ? 'settings' : 'record')
    return out
  }
  if (p.end?.kind === 'error' || p.end?.kind === 'cutOff') for (const f of p.fixes ?? ['record']) add(f)
  if (p.mended && p.mended.count > 0) add('undo')
  if ((p.questions ?? 0) + (p.checkFound ?? 0) > 0) add('issues')
  if (p.phrases && p.phrases.phrase + p.phrases.ai > 0) add('phrases')
  // The Issues list and the first phrase open the scene too; otherwise, a draft written elsewhere has Show.
  if (p.away && !out.includes('issues') && !out.includes('phrases')) add('scene')
  return out
}

// ---------- Another of Adam's models ----------

/** The order Adam's other models are offered in: those he chose for writing-like jobs first. */
const OFFER_ORDER = ['writer', 'chat', 'memory', 'check', 'builder', 'world', 'chapter', 'director', 'recipe', 'speech'] as const

const keyOf = (m: Pick<ModelChoice, 'providerId' | 'modelId'>): string => `${m.providerId}:${m.modelId}`

/**
 * Another model Adam has already set up in Settings › Models (the writer's, chat's, the memory's…), for trying again
 * after a refusal: the first that isn't one of `not` (the model that refused, and any tried already). Null when he has
 * no other.
 */
export function anotherModel(models: Partial<Record<string, ModelChoice | null>> | null | undefined, not: (Pick<ModelChoice, 'providerId' | 'modelId'> | null | undefined)[]): ModelChoice | null {
  const skip = new Set(not.filter((m): m is Pick<ModelChoice, 'providerId' | 'modelId'> => !!m).map(keyOf))
  for (const job of OFFER_ORDER) {
    const m = models?.[job]
    if (m && !skip.has(keyOf(m))) return m
  }
  return null
}

/** A model's name as Settings › Models shows it, short: "Claude Sonnet 4.6" for "anthropic/claude-sonnet-4.6". */
export function modelName(m: Pick<ModelChoice, 'label' | 'modelId'>): string {
  const label = (m.label || m.modelId).trim()
  // "Anthropic: Claude Sonnet 4.6" → "Claude Sonnet 4.6"; "fake/refuse" stays as it is.
  return label.includes(': ') ? label.slice(label.indexOf(': ') + 2) : label
}
