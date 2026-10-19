// What the writer model is told when Adam asks for a critique of a scene or a chapter (contracts/critique.ts). Every
// system prompt starts with "[AIWRITE-CRITIQUE v1] <scene|chapter>", so the fake provider in tests recognises it. The
// briefing is lean: how the story is written (genre, tone, point of view, tense, the author's notes), the facts it must
// respect (premise, themes, the content level and limits, what the card plans, the chapter's goal, the plot threads and
// when each is due, the scene's contract, the open must-fix problems), what the author has said he wants (memory.ts),
// who is in it, where it sits, and the words themselves; each part has shorter forms (outline/briefing.ts fitBlocks), and a
// chapter too long for the model is sent with its scenes shortened to their openings and endings, then to their
// summaries, rather than refused. Pure, so it is unit-tested.

import type { CritiqueScope } from '@shared/contracts/critique'
import type { ContractCheckItem } from '@shared/contracts/checks'
import type { Entry, ID, StyleGuide, ThreadDue } from '@shared/types'
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
- Respect the "Facts to respect": never suggest cutting or changing what the scene card, the chapter's goal, the scene's contract or a plot thread due now requires (a beat it lists, the outcome it plans, a thread it sets up or pays off). Say how to do it better instead.
- A set-up whose pay-off is planned for later is not a missing pay-off: never ask for it to be paid off or explained here.
- Respect the content level the author chose: never ask to tone down, cut, fade out or soften the sex, violence or language it allows. Judge those passages only as writing.
- Respect "What the author has said he wants": never raise a note he said isn't needed, or a kind of note he said isn't for this story, and never give the opposite of a note he acted on.
- The open consistency problems listed are being fixed elsewhere: don't repeat them as notes, and never suggest anything that keeps them.
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

/** Said when a reply couldn't be read, at the end of the same request asked once more (without the reply: 2026-10-19). */
export const retryMessage = (why: string, cutOff: boolean): string =>
  `Your last reply to this couldn't be used: ${why}. Reply with only the JSON object, in exactly the format given, with every quote copied exactly from the text.${
    cutOff ? ' Keep it shorter: fewer notes, and a sentence or two for each.' : ''
  }`

/**
 * What the last part of the briefing asks for. On a re-read (`again`), the chapter writer's (AGAIN_LINE) or Adam's
 * Critique again (`o.adam`, SECOND_LINE); with the notes last time sent (`o.earlier`), which are settled and which a
 * note gives again (EARLIER_REPLY).
 */
export function critiqueAsk(scope: CritiqueScope, title: string, again = false, o: { adam?: boolean; earlier?: boolean } = {}): string {
  const named = clean(title) ? ` “${clean(title)}”` : ''
  const ask = `Critique the ${scope}${named} now, as one JSON object.${o.earlier ? ` ${EARLIER_REPLY}` : ''}`
  if (!again) return ask
  return `${o.adam ? SECOND_LINE(scope) : AGAIN_LINE(scope)}

${ask}`
}

/** Said on a re-read after revisions (the chapter writer): the critic may find it ready. */
export const AGAIN_LINE = (scope: CritiqueScope): string =>
  `This is a re-read: the ${scope} has been revised since your last notes. Give only notes still clearly worth fixing, the kind a good editor would insist on. If the ${scope} is ready, give no notes at all ("notes": []).`

/** Said when Adam asks for a critique again: it builds on the notes before rather than hunting afresh. */
export const SECOND_LINE = (scope: CritiqueScope): string =>
  `This is a second reading: you critiqued this ${scope} before, and the author has worked on it since. Your notes from last time are under "Your notes last time", with what became of each. Never reverse a note he acted on (if he tightened a passage you said dragged, don't now say it rushes), never raise again what he set aside, and give a note from last time again only if the words still clearly have that problem. New notes are welcome where they matter. If the ${scope} is ready, give no notes ("notes": []).`

/** The reply's extra fields when the notes last time were sent. */
export const EARLIER_REPLY =
  'Also give "settled": the ids of your notes last time that are dealt with now (such as ["P1", "P3"]), and on a note that gives one of them again because it still stands, "earlier": its id (such as "P2").'

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
  add("The author's other notes", o.style.notes ?? '', 400)
  return lines.join('\n')
}

// ---------- Facts to respect ----------

/** A plot thread in the facts: its name, what it promises, and when it is due in plain words. */
export interface FactsThread {
  name: string
  promise: string
  when: string
}

/** What the critic must respect (critique/run.ts gathers it). Empty strings and lists are left out. */
export interface CritiqueFacts {
  premise: string
  themes: string
  /** One line per content scale the author set (shared/intensity.ts intensityLines). */
  content: string[]
  limits: string
  /** What the scene card plans (a scene's critique), or the chapter card's notes (a chapter's, as `notes`). */
  card: { goal: string; conflict: string; outcome: string; beats: string[]; notes: string; setsUp: string[]; paysOff: string[] } | null
  chapterGoal: string
  /** A chapter's critique: what each scene's card plans, a line each. */
  scenes: string[]
  threads: FactsThread[]
  /** The scene's contract, from its latest draft that had one. */
  contract: Pick<ContractCheckItem, 'part' | 'text'>[]
  /** Open must-fix problems the consistency check found (`where`: a chapter's scene, by its title). */
  mustFix: { where: string; quote: string; message: string }[]
}

export const NO_FACTS: CritiqueFacts = {
  premise: '',
  themes: '',
  content: [],
  limits: '',
  card: null,
  chapterGoal: '',
  scenes: [],
  threads: [],
  contract: [],
  mustFix: []
}

/** When a thread is due, in the critic's words: a set-up for later is not a missing pay-off. */
export function dueForCritic(due: ThreadDue | undefined): string {
  if (!due) return 'still open, with no pay-off planned yet'
  const card = due.from === 'card' && !!due.sceneLabel
  switch (due.state) {
    case 'now':
      return 'due to be paid off by the end of this chapter'
    case 'overdue':
      return card ? `overdue: its pay-off was planned for ${due.sceneLabel}` : `overdue: it was to be paid off by the end of ${due.label}`
    case 'later':
      return `${card ? `its pay-off is planned for ${due.sceneLabel}` : `to be paid off by the end of ${due.label}`}, later: not a missing pay-off here`
  }
}

const CONTRACT_PARTS: Record<ContractCheckItem['part'], string> = {
  start: 'Must be true at the start',
  change: 'Must change',
  keep: 'Must not change'
}

/** How many of each list each form keeps: full, short, smallest. */
const FACT_MOST = {
  threads: [10, 4, 3],
  contract: [12, 6, 4],
  mustFix: [6, 3, 0],
  scenes: [12, 6, 0],
  beats: [16, 10, 6]
} as const

/** A thread the scene itself sets up or pays off, or one due now or overdue: kept in the smallest form. */
const urgent = (t: FactsThread): boolean => /^(this scene|due|overdue)/.test(t.when)

/**
 * "Facts to respect" in its forms, longest first: the full form, a short one (the main facts, fewer threads and
 * problems), and the smallest (the content level, what the card plans, what the contract says must change, the threads
 * the scene sets up or pays off and those due now). The block is never left out (critique/run.ts). [''] only when
 * there is nothing at all to say.
 */
export function factsForms(f: CritiqueFacts, scope: CritiqueScope): string[] {
  const form = (level: 0 | 1 | 2): string => {
    const lines: string[] = []
    const add = (label: string, v: string, n: number): void => {
      if (clean(v)) lines.push(`${label}: ${cap(clean(v), n)}`)
    }
    if (level < 2) {
      add('Premise', f.premise, level ? 200 : 500)
      add('Themes', f.themes, level ? 160 : 300)
    }
    if (f.content.length) lines.push(`The content level the author chose:\n${f.content.map((l) => `- ${cap(clean(l), 240)}`).join('\n')}`)
    add('Content limits (always respect these)', f.limits, level === 2 ? 240 : 500)
    if (f.card) {
      const c = f.card
      const card: string[] = []
      const put = (label: string, v: string, n: number): void => {
        if (clean(v)) card.push(`- ${label}: ${cap(clean(v), n)}`)
      }
      put('Goal', c.goal, 300)
      if (level < 2) put('Conflict', c.conflict, 300)
      put('Outcome', c.outcome, 300)
      const beats = c.beats.map(clean).filter(Boolean).slice(0, FACT_MOST.beats[level])
      if (beats.length) card.push(`- Beats: ${beats.map((b, i) => `(${i + 1}) ${cap(b, level === 2 ? 120 : 200)}`).join('; ')}`)
      put('Notes', c.notes, level === 2 ? 200 : level ? 400 : 700)
      put('Sets up', c.setsUp.join(', '), 200)
      put('Pays off', c.paysOff.join(', '), 200)
      if (card.length) lines.push(`${scope === 'scene' ? 'What the scene card plans' : 'What the chapter card plans'}:\n${card.join('\n')}`)
    }
    add("The chapter's goal", f.chapterGoal, level === 2 ? 200 : 300)
    const scenes = f.scenes.slice(0, FACT_MOST.scenes[level])
    if (scenes.length) lines.push(`What each scene's card plans:\n${scenes.map((l) => `- ${cap(clean(l), 240)}`).join('\n')}`)
    const threads = (level === 2 ? f.threads.filter(urgent) : f.threads).slice(0, FACT_MOST.threads[level])
    if (threads.length) {
      lines.push(
        `Plot threads, and when each is due:\n${threads
          .map((t) => `- ${cap(clean(t.name), 80)}${level < 2 && clean(t.promise) ? ` (${cap(clean(t.promise), level ? 80 : 160)})` : ''}: ${t.when}`)
          .join('\n')}`
      )
    }
    const contract = (level === 2 ? f.contract.filter((i) => i.part === 'change') : f.contract).slice(0, FACT_MOST.contract[level])
    if (contract.length) {
      lines.push(
        `This scene's contract (what its latest draft was written to):\n${contract.map((i) => `- ${CONTRACT_PARTS[i.part]}: ${cap(clean(i.text), 200)}`).join('\n')}`
      )
    }
    const problems = f.mustFix.slice(0, FACT_MOST.mustFix[level])
    if (problems.length) {
      lines.push(
        `Problems the consistency check found that must be fixed (being dealt with elsewhere):\n${problems
          .map((p) => `- ${p.where ? `In ${p.where}: ` : ''}${p.quote.trim() ? `“${cap(clean(p.quote), 120)}”: ` : ''}${cap(clean(p.message), 220)}`)
          .join('\n')}`
      )
    }
    return lines.join('\n')
  }
  const full = form(0)
  if (!full) return ['']
  return [full, form(1), form(2)]
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
