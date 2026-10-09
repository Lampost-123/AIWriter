// What the writer model is told when Adam asks for a critique of a scene or a chapter (contracts/critique.ts). Every
// system prompt starts with "[AIWRITE-CRITIQUE v1] <scene|chapter>", so the fake provider in tests recognises it. The
// briefing is lean: how the story is written (genre, tone, point of view, tense), the card, who is in it, where it
// sits, and the words themselves; each part has shorter forms (outline/brief.ts fitBlocks), and a chapter too long for
// the model is sent with its scenes shortened to their openings and endings, then to their summaries, rather than
// refused. Pure, so it is unit-tested.

import type { CritiqueScope } from '@shared/contracts/critique'
import type { Entry, ID, StyleGuide } from '@shared/types'
import { countWords } from '@shared/defaults'
import { genresOf } from '@shared/genres'

export const CRITIQUE_MARKER = '[AIWRITE-CRITIQUE v1]'

/** At most this many notes and strengths are kept (and asked for). */
export const MAX_NOTES = 8
export const MAX_STRENGTHS = 3

/** Room for the reply: a summary, a few strengths and eight notes, with some to spare. */
export const CRITIQUE_REPLY = 2500
/** Steady: the critic judges, it doesn't invent. */
export const CRITIQUE_TEMPERATURE = 0.4

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()
const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

// ---------- The instructions ----------

const SCENE_LOOKS = `- Pacing: where the scene drags or rushes, and whether its length suits what happens in it.
- Tension and stakes: what the point-of-view character wants here, what stands in the way, what it could cost, and whether the reader feels it.
- Character voice and dialogue: whether each person sounds like themselves, and whether the dialogue does more than pass on information.
- Clarity: whether the reader can follow who is where, doing what, and why.
- Show and tell: feelings and facts explained where a moment could show them (or a long moment where a line of summary would do).
- Prose: repeated words and sentence patterns, filler, clichés, overwritten or flat lines.
- The opening and the ending: whether it starts late enough to pull the reader in, and ends on something that moves the story on.`

const CHAPTER_LOOKS = `- The chapter's shape and arc: whether it has a clear movement and a turn, and does what the chapter is for.
- How the scenes flow into each other: transitions, jumps in time or place the reader can't follow, scenes that repeat each other's work.
- Pacing across the scenes: where the chapter drags or rushes, and scenes that run long for what they do.
- The ending: whether the chapter ends with a pull to read on.
- Anything inside one scene that weakens the chapter as a whole (tension that drops away, a voice that slips).`

const CATEGORIES: Record<CritiqueScope, string> = {
  scene: 'pacing, tension, voice, dialogue, clarity, show-tell, prose, opening, ending',
  chapter: "shape, flow, pacing, pull (the ending's pull to read on), tension, voice, dialogue, clarity, prose, opening"
}

/** The instructions for critiquing a scene or a chapter. */
export function critiqueSystem(scope: CritiqueScope): string {
  const what = scope === 'scene' ? 'one scene' : 'one chapter'
  return `${CRITIQUE_MARKER} ${scope}
You are an experienced fiction editor giving a novelist honest, specific feedback on the craft of ${what} of their novel. You don't check facts or continuity against the rest of the story (that is done elsewhere): you judge how the ${scope} works as writing. Reply with one JSON object and nothing else.

What to look at
${scope === 'scene' ? SCENE_LOOKS : CHAPTER_LOOKS}

Rules
- Be honest and specific. Praise only what really works, and never invent problems to fill the list: a strong ${scope} may need only one or two notes.
- At most ${MAX_NOTES} notes: the ones that would improve the ${scope} most, the most important first. Each note is about one thing.
- Write to the author in plain English, as "you": short sentences, no jargon, no grades or scores.
- Keep to the story's genre, tone, point of view and tense as given: never ask for a different kind of book.
- "quote": words copied exactly, character for character, from the ${scope === 'scene' ? 'scene' : "chapter's scenes (from one scene)"}: the sentence or short passage the note is about, at most about 40 words. Use "" when the note is about the ${scope} as a whole.${
    scope === 'chapter'
      ? '\n- Some scenes may be shortened, with [… words left out …] where words were cut: quote only words that are shown.'
      : ''
  }
- "category": one of ${CATEGORIES[scope]}.
- "weight": "high" when it matters most, "medium" when it is worth a look, "low" when it is a small thing.
- "title": a few words naming it, such as "The middle sags".
- "suggestion": one to three plain sentences on what to do about it, concrete enough to act on.
- "summary": two or three sentences on how the ${scope} reads overall.
- "strengths": up to ${MAX_STRENGTHS} short lines on what works, each particular to this ${scope}.

Reply with:
{"summary": "...", "strengths": ["..."], "notes": [{"category": "pacing", "weight": "high", "title": "...", "quote": "...", "suggestion": "..."}]}`
}

/** Said when a reply couldn't be read, before asking once more. */
export const retryMessage = (why: string, cutOff: boolean): string =>
  `Your reply couldn't be used: ${why}. Reply again with only the JSON object, in exactly the format given, with every quote copied exactly from the text.${
    cutOff ? ' Keep it shorter: fewer notes, and a sentence or two for each.' : ''
  }`

/** What the last part of the briefing asks for. */
export function critiqueAsk(scope: CritiqueScope, title: string): string {
  const named = clean(title) ? ` “${clean(title)}”` : ''
  return `Critique the ${scope}${named} now, as one JSON object.`
}

// ---------- How the story is written ----------

/** The style and feel in effect, in a few lines: genre, tone, point of view, tense, prose style. */
export function storyLines(o: { title: string; style: StyleGuide; tone: string }): string {
  const lines = [`Title: ${clean(o.title) || 'Untitled story'}`]
  const add = (label: string, v: string, n = 300): void => {
    if (clean(v)) lines.push(`${label}: ${cap(clean(v), n)}`)
  }
  const [lead, blend] = genresOf(o.style.genres ?? [])
  if (lead) add('Genre', `${lead.label} (${lead.feel})${blend ? `, with ${blend.label.toLocaleLowerCase()} (${blend.feel})` : ''}`)
  add("The author's take on it", o.style.genreNotes, 240)
  add('Tone', o.tone, 200)
  add('Point of view', o.style.pov, 120)
  add('Tense', o.style.tense, 60)
  add('Prose style', o.style.proseStyle)
  return lines.join('\n')
}

// ---------- Who is in it ----------

/** Entries named in the words, or on the card, the card's first; characters before places. */
export function castFor(entries: Entry[], text: string, first: ID[] = []): Entry[] {
  const lower = text.toLowerCase()
  const named = (e: Entry): boolean =>
    [e.name, ...e.aliases].some((n) => {
      const w = n.trim().toLowerCase()
      return w.length > 1 && lower.includes(w)
    })
  const order: Entry['kind'][] = ['character', 'place', 'group', 'item']
  return entries
    .filter((e) => order.includes(e.kind) && clean(e.name) && (first.includes(e.id) || named(e)))
    .sort((a, b) => Number(first.includes(b.id)) - Number(first.includes(a.id)) || order.indexOf(a.kind) - order.indexOf(b.kind))
}

/**
 * A line for each: name, kind and what they are; for a character in the full form also how they speak and what they
 * want, since voice and stakes are judged against them. `limit` caps how many.
 */
export function castText(cast: Entry[], limit: number, full: boolean): string {
  return cast
    .slice(0, limit)
    .map((e) => {
      const about = cap(clean(e.summary) || clean(e.description), full ? 160 : 90)
      const extra =
        full && e.kind === 'character'
          ? [
              clean(e.fields?.speech) ? `Speaks: ${cap(clean(e.fields.speech), 120)}` : '',
              clean(e.fields?.wants) ? `Wants: ${cap(clean(e.fields.wants), 100)}` : ''
            ].filter(Boolean)
          : []
      return `- ${clean(e.name)} (${e.kind})${about ? `: ${about}` : ''}${extra.length ? ` ${extra.join('. ')}.` : ''}`
    })
    .join('\n')
}

// ---------- The words ----------

/** Splits text into its paragraphs (blank lines or line breaks between them). */
const paragraphsOf = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

const gap = (words: number): string => `[… ${words.toLocaleString('en-GB')} words left out …]`

/**
 * The text shortened to about `most` words: its opening and its ending, whole paragraphs where it can, with a marker
 * saying how many words were left out between them. Text already short enough comes back as it is.
 */
export function shortened(text: string, most: number): string {
  const total = countWords(text)
  if (total <= most) return text.trim()
  const paras = paragraphsOf(text)
  const half = Math.max(20, Math.floor(most / 2))
  const head: string[] = []
  const tail: string[] = []
  let headWords = 0
  let tailWords = 0
  let i = 0
  let j = paras.length - 1
  while (i <= j && headWords + countWords(paras[i]) <= half) {
    head.push(paras[i])
    headWords += countWords(paras[i])
    i++
  }
  while (j >= i && tailWords + countWords(paras[j]) <= half) {
    tail.unshift(paras[j])
    tailWords += countWords(paras[j])
    j--
  }
  // A first or last paragraph longer than half on its own: its first (or last) words.
  if (!head.length && i <= j) {
    const words = paras[i].split(/\s+/)
    head.push(words.slice(0, half).join(' '))
    headWords = half
  }
  if (!tail.length && j >= i) {
    const words = paras[j].split(/\s+/)
    tail.push(words.slice(-half).join(' '))
    tailWords = half
  }
  return [...head, gap(Math.max(1, total - headWords - tailWords)), ...tail].join('\n\n')
}

/** The scene's text in its forms, longest first: whole, then its opening and ending at two lengths. */
export function sceneTextForms(text: string): string[] {
  const words = countWords(text)
  const forms = [text.trim()]
  for (const share of [0.6, 0.35]) {
    const most = Math.floor(words * share)
    if (most >= 150) forms.push(`(The scene is too long to send whole: its opening and ending follow.)\n${shortened(text, most)}`)
  }
  return forms
}

export interface ChapterScene {
  title: string
  text: string
  /** Its summary from the memory, '' when there is none yet. */
  summary: string
}

const sceneHead = (s: ChapterScene, n: number): string =>
  `### Scene ${n}: ${clean(s.title) || 'Untitled scene'} (about ${countWords(s.text).toLocaleString('en-GB')} words)`

const SHORTENED_NOTE =
  '(The chapter is too long to send whole, so some scenes are shortened: their summary, then their opening and ending, with [… words left out …] where words were cut.)'

/**
 * The chapter's scenes in their forms, longest first: every scene whole; then each scene over a length cut to its
 * opening and ending (with its summary), at three lengths; then each scene's summary alone (its first and last lines
 * when it has none).
 */
export function chapterTextForms(scenes: ChapterScene[]): string[] {
  const whole = scenes.map((s, i) => `${sceneHead(s, i + 1)}\n${s.text.trim()}`).join('\n\n')
  const cut = (most: number): string =>
    `${SHORTENED_NOTE}\n\n${scenes
      .map((s, i) => {
        const short = countWords(s.text) > most
        const summary = short && clean(s.summary) ? `Summary: ${clean(s.summary)}\n` : ''
        return `${sceneHead(s, i + 1)}\n${summary}${short ? shortened(s.text, most) : s.text.trim()}`
      })
      .join('\n\n')}`
  const summaries = `${SHORTENED_NOTE}\n\n${scenes
    .map((s, i) => `${sceneHead(s, i + 1)}\n${clean(s.summary) ? `Summary: ${clean(s.summary)}` : shortened(s.text, 80)}`)
    .join('\n\n')}`
  return [whole, cut(1200), cut(500), cut(200), summaries]
}
