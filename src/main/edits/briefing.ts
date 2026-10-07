// The briefing for an AI edit of selected words, or for Continue: compact, and only what the job needs.
// The style guide with Adam's preferences, the point of view and tense, the characters in the scene (for
// Fix voice, each speaker's voice and who says which line), the words around the selection, the selection
// itself, and the job once more at the end. For Continue, the scene so far, the scene card's beats and where things
// stand at the point it carries on from (where each person is, what they wear, how they are placed).
// Each part is also a block of the record, so "What the AI saw" shows exactly what was sent.
// Pure (no database), so it can be tested.

import type { ChatMessage, ContextBlock, Creativity, EntryState, ID, SceneCard, StyleGuide } from '@shared/types'
import { keepsLineBreaks, type EditInput } from '@shared/contracts/edits'
import { CREATIVITY_PRESETS, countWords } from '@shared/defaults'
import { fieldSections, mentions, openingSentences, REPLY_LIMIT_CAP, sceneTail, TAG_ALLOWANCE, TOKENS_PER_WORD } from '../ai/context'
import { indentMore } from '../ai/prompts'
import { estimateTokens } from '../keeper/text'
import { stateText, type SceneState } from '@shared/continuity'
import { CONTINUE_WORDS, finalAsk, systemPrompt, type PromptOptions } from './prompts'
import { whoSpeaks, type SpokenLine } from './speakers'

/** What the briefing is made from, read from the open world by the caller. */
export interface EditWorld {
  /** The style guide in effect (Adam's preferences, the world's and the story's). */
  style: StyleGuide
  scene: { title: string; card: SceneCard }
  /** Every entry that exists at the scene, as of it (what the memory knows there). */
  entries: EntryState[]
  /** The writer model's context length, when known. */
  contextLength: number | null
  /** Ask the writer to tag who says each line and how (ai/speakerTags.ts). */
  speakerTags?: boolean
  /** For Continue: where things stand at the point it carries on from (continuity/tracker.ts), or null when not known. */
  stand?: SceneState | null
}

export type EditBriefing =
  | {
      ok: true
      messages: ChatMessage[]
      blocks: ContextBlock[]
      /** Each memory entry sent, with the version (updatedAt) that was sent. */
      entries: { entryId: ID; version: string }[]
      /** Room for the reply itself, in tokens. */
      reply: number
      temperature: number
      topP: number
      /** A plain-words note for Adam about how it was set up, or null. */
      note: string | null
    }
  | { ok: false; problem: string; entryId?: ID; entryName?: string }

/** What Continue's "Where things stand" says first. */
export const STAND_LEAD_HERE =
  'Where things stand at the point you carry on from. Keep to it exactly: where each person is, what they wear and how it sits, how they are placed and what they hold. Nothing changes unless it happens on the page, in your words.'

/** The longest selection each tool works on, in words. */
export const MAX_WORDS = { alternatives: 1200, other: 3000 }

/** How much of the text around the selection is sent, in words. */
const AROUND = {
  edit: { before: 250, after: 120 },
  voice: { before: 350, after: 120 },
  continue: { before: 1200, after: 150 }
}

/** At most this many characters are described. */
const MAX_CHARACTERS = { other: 6, voice: 8 }

/** The context length assumed when the model's isn't known. */
const DEFAULT_CONTEXT = 16_000

/** How freely each tool writes. */
const CREATIVITY: Record<EditInput['tool'], Creativity> = {
  rewrite: 'balanced',
  expand: 'balanced',
  condense: 'steady',
  vivid: 'balanced',
  tone: 'balanced',
  voice: 'steady',
  alternatives: 'adventurous',
  continue: 'balanced'
}

/** Room for the reply, in tokens: the selection's length times how much the tool may grow it, and a little more. */
export function replyRoom(tool: EditInput['tool'], selectionWords: number): number {
  const t = selectionWords * TOKENS_PER_WORD
  const room =
    tool === 'continue'
      ? CONTINUE_WORDS.max * TOKENS_PER_WORD * 2
      : tool === 'alternatives'
        ? 3 * t * 1.6 + 150
        : tool === 'expand' || tool === 'rewrite'
          ? t * 2.4 + 200
          : tool === 'condense'
            ? t * 1.1 + 150
            : t * 1.6 + 200
  return Math.min(REPLY_LIMIT_CAP, Math.max(400, Math.ceil(room)))
}

const VOICE_KEYS = ['speech', 'tics', 'neverSays', 'sampleLines']

/** True when a character has any of the voice fields filled in. */
export const hasVoice = (e: EntryState): boolean => VOICE_KEYS.some((k) => !!e.fields?.[k]?.trim())

/** A character, compactly: names, the one-line summary, and the fields this tool needs. */
function profile(e: EntryState, keys: ReadonlySet<string>): string {
  const head = [`### ${e.name}`]
  const aliases = (e.aliases ?? []).map((a) => a.trim()).filter(Boolean)
  if (aliases.length) head.push(`Also called: ${aliases.join(', ')}`)
  if (e.summary?.trim()) head.push(`In short: ${e.summary.trim()}`)
  else if (e.description?.trim()) head.push(openingSentences(e.description, 40))
  return [head.join('\n'), ...fieldSections(e, undefined, true, keys)].join('\n')
}

const KEYS = {
  other: new Set(['pronouns', 'age', 'role', 'speech', 'tics', 'sampleLines']),
  voice: new Set(['pronouns', 'age', 'role', 'traits', ...VOICE_KEYS]),
  continue: new Set(['pronouns', 'age', 'role', 'traits', 'wants', 'motivation', ...VOICE_KEYS])
}

const fence = (text: string): string => `"""\n${text}\n"""`

/** The last `words` words of a text, cut at the start of a paragraph or sentence where possible. */
function lastWords(text: string, words: number): string {
  const t = text.trim()
  if (!t || words <= 0) return ''
  return sceneTail(t, { min: Math.floor(words / 2), target: Math.floor(words * 0.8), max: words })
}

/** The first `words` words of a text, ending at the end of a paragraph or sentence where possible. */
function firstWords(text: string, words: number): string {
  const t = text.trim()
  if (!t || words <= 0) return ''
  const all = [...t.matchAll(/\S+/g)]
  if (all.length <= words) return t
  const cut = t.slice(0, (all[words - 1].index ?? 0) + all[words - 1][0].length)
  const para = cut.lastIndexOf('\n')
  if (para > cut.length / 2) return cut.slice(0, para).trim()
  let best = -1
  for (const m of cut.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)) best = (m.index ?? 0) + m[0].length
  return best > cut.length / 2 ? cut.slice(0, best) : `${cut}…`
}

const joinAnd = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** Where the selection sits: at the start of a paragraph or part-way through one, and the same at its end. */
function placeLine(before: string, after: string): string {
  const starts = !before.trim() || /\n\s*$/.test(before)
  const ends = !after.trim() || /^\s*\n/.test(after)
  if (starts && ends) return 'The selected words are whole paragraphs.'
  if (starts) return 'The selected words start a paragraph and stop part-way through one: the text after them carries on that paragraph.'
  if (ends)
    return 'The selected words start part-way through a paragraph, straight after the text before them, and run to the end of a paragraph.'
  return 'The selected words sit inside a paragraph: the text before them leads straight into them, and the text after carries straight on.'
}

/** The scene: its title, point of view, place, time and mood; for Continue also its plan. */
function sceneText(world: EditWorld, byId: Map<ID, EntryState>, full: boolean): { text: string; entryIds: ID[] } {
  const c = world.scene.card
  const lines: string[] = []
  const ids: ID[] = []
  if (world.scene.title.trim()) lines.push(`Scene: “${world.scene.title.trim()}”`)
  const pov = c.povId ? byId.get(c.povId) : undefined
  if (pov) lines.push(`Point-of-view character: ${pov.name}`)
  const place = c.locationId ? byId.get(c.locationId) : undefined
  if (place) {
    lines.push(`Where: ${place.name}${place.summary?.trim() ? ` (${place.summary.trim()})` : ''}`)
    ids.push(place.id)
  }
  if (c.when?.trim()) lines.push(`When: ${c.when.trim()}`)
  if (c.mood?.trim()) lines.push(`Mood: ${c.mood.trim()}`)
  if (full) {
    if (c.goal?.trim()) lines.push(`Goal: ${indentMore(c.goal)}`)
    if (c.conflict?.trim()) lines.push(`Conflict: ${indentMore(c.conflict)}`)
    if (c.outcome?.trim()) lines.push(`Outcome: ${indentMore(c.outcome)}`)
    const beats = (c.beats ?? []).map((b) => b.trim()).filter(Boolean)
    if (beats.length) lines.push(`Beats, in order:\n${beats.map((b, i) => `${i + 1}. ${indentMore(b, '   ')}`).join('\n')}`)
    if (c.notes?.trim()) lines.push(`The author's notes: ${indentMore(c.notes)}`)
  }
  return { text: lines.join('\n'), entryIds: ids }
}

interface Part {
  id: string
  priority: number
  title: string
  text: string
  entryIds: ID[]
}

/** Builds the briefing, or says in plain words why these words can't be done. */
export function editBriefing(input: EditInput, world: EditWorld): EditBriefing {
  const tool = input.tool
  const direction = (input.direction ?? '').trim()
  const selection = input.selection.trim()
  const isContinue = tool === 'continue'
  const words = countWords(selection)
  const max = tool === 'alternatives' ? MAX_WORDS.alternatives : MAX_WORDS.other
  if (!isContinue && !words) return { ok: false, problem: 'Select some words first.' }
  if (words > max) {
    const what = tool === 'alternatives' ? 'Alternatives work' : 'The AI tools work'
    return {
      ok: false,
      problem: `${what} on up to about ${max.toLocaleString('en-GB')} words at a time. Select fewer words and try again.`
    }
  }

  const byId = new Map(world.entries.map((e) => [e.id, e]))
  const characters = world.entries.filter((e) => e.kind === 'character')
  const card = world.scene.card

  // Fix voice: who says each line, and whether they have a voice to match.
  let lines: SpokenLine[] = []
  let note: string | null = null
  if (tool === 'voice') {
    const cast = characters.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [], pronouns: e.fields?.pronouns ?? '' }))
    lines = whoSpeaks({ before: input.before, selection: input.selection, after: input.after, cast, povId: card.povId })
    const problem = voiceProblem(lines, byId)
    if (problem) return problem
    note = voiceNote(lines, byId)
  }

  // The characters: point of view, the speakers, those on the scene card, then those named near the words.
  const aroundWords = isContinue ? AROUND.continue : tool === 'voice' ? AROUND.voice : AROUND.edit
  const near = `${lastWords(input.before, aroundWords.before)}\n${selection}\n${firstWords(input.after, aroundWords.after)}`
  const order: ID[] = []
  const add = (id: ID | null | undefined): void => {
    if (id && byId.get(id)?.kind === 'character' && !order.includes(id)) order.push(id)
  }
  add(card.povId)
  for (const l of lines) add(l.speakerId)
  for (const id of card.presentIds ?? []) add(id)
  for (const e of characters) if ([e.name, ...(e.aliases ?? [])].some((n) => mentions(near, n))) add(e.id)
  const keys = tool === 'voice' ? KEYS.voice : isContinue ? KEYS.continue : KEYS.other
  const people = order.slice(0, tool === 'voice' ? MAX_CHARACTERS.voice : MAX_CHARACTERS.other).map((id) => byId.get(id)!)

  const o: PromptOptions = {
    direction,
    continueAs: input.continueAs ?? 'paragraph',
    hasAfter: !!input.after.trim(),
    lineBreaks: keepsLineBreaks(input),
    ...(world.speakerTags ? { speakerTags: true } : {})
  }
  const system = systemPrompt(tool, world.style, o)
  const reply = Math.ceil(replyRoom(tool, words) * (world.speakerTags ? 1 + TAG_ALLOWANCE : 1))
  const contextLength = world.contextLength && world.contextLength > 0 ? world.contextLength : DEFAULT_CONTEXT
  const room = Math.floor(contextLength * 0.85) - reply

  /** The parts, as big as `scale` allows (1 is full size; smaller sends less of the text around and fewer people). */
  const build = (scale: number, withPeople: boolean, withAfter: boolean): Part[] => {
    const parts: Part[] = []
    const scene = sceneText(world, byId, isContinue)
    if (scene.text) parts.push({ id: 'scene', priority: 2, title: 'The scene', text: scene.text, entryIds: scene.entryIds })
    const shown = withPeople ? people.slice(0, Math.max(tool === 'voice' ? people.length : 1, Math.round(people.length * scale))) : []
    const voiced = tool === 'voice' ? people.filter((p) => lines.some((l) => l.speakerId === p.id)) : []
    const describe = withPeople ? shown : voiced
    if (describe.length) {
      const title = tool === 'voice' ? 'The speakers and their voices' : 'Characters in the scene'
      parts.push({
        id: 'characters',
        priority: 3,
        title,
        text: `${title}\n\n${describe.map((e) => profile(e, keys)).join('\n\n')}`,
        entryIds: describe.map((e) => e.id)
      })
    }
    if (tool === 'voice') {
      const list = lines.map((l, i) => {
        const who = l.speakerId ? byId.get(l.speakerId) : undefined
        const name = !who
          ? 'Not known (leave it as it is)'
          : hasVoice(who)
            ? who.name
            : `${who.name}, who has no voice profile yet (leave it as it is)`
        return `${i + 1}. ${name}: ${l.quote}`
      })
      parts.push({
        id: 'speakers',
        priority: 1,
        title: 'Who says each line',
        text: `Who says each line, worked out from the speech tags and names:\n${list.join('\n')}`,
        entryIds: []
      })
    }
    const before = lastWords(input.before, Math.round(aroundWords.before * scale))
    if (isContinue) {
      parts.push({
        id: 'before',
        priority: 1,
        title: 'The scene so far',
        text: `The scene so far, up to where you carry on:\n${fence(before)}\n${o.continueAs === 'inline' ? 'It stops part-way through a paragraph.' : 'It stops at the end of a paragraph.'}`,
        entryIds: []
      })
    } else {
      if (before)
        parts.push({
          id: 'before',
          priority: 3,
          title: 'The text before',
          text: `The text just before the selected words:\n${fence(before)}`,
          entryIds: []
        })
      parts.push({
        id: 'selection',
        priority: 1,
        title: 'The selected words',
        text: `The selected words (your reply takes their place):\n${fence(selection)}\n${placeLine(input.before, input.after)}`,
        entryIds: []
      })
    }
    const after = withAfter ? firstWords(input.after, Math.round(aroundWords.after * scale)) : ''
    if (after) {
      const title = isContinue ? 'The text that comes after' : 'The text after'
      const lead = isContinue ? "The text that comes after (lead into it; don't repeat it):" : 'The text just after the selected words:'
      parts.push({ id: 'after', priority: 4, title, text: `${lead}\n${fence(after)}`, entryIds: [] })
    }
    const stand = isContinue && world.stand ? stateText(world.stand) : ''
    if (stand) parts.push({ id: 'stand', priority: 2, title: 'Where things stand', text: `${STAND_LEAD_HERE}\n${stand}`, entryIds: [] })
    parts.push({ id: 'ask', priority: 1, title: 'What the AI was asked', text: finalAsk(tool, o), entryIds: [] })
    return parts
  }

  const size = (parts: Part[]): number => estimateTokens(system) + parts.reduce((n, p) => n + estimateTokens(p.text) + 4, 0)
  // Smaller and smaller until it fits: less of the text around and fewer people, then without the text after, then without the people.
  const tries: [number, boolean, boolean][] = [
    [1, true, true],
    [0.5, true, true],
    [0.25, true, true],
    [0.25, true, false],
    [0.25, false, false],
    [0, false, false]
  ]
  let parts: Part[] | null = null
  for (const [scale, withPeople, withAfter] of tries) {
    const p = build(scale, withPeople, withAfter)
    if (size(p) <= room) {
      parts = p
      break
    }
  }
  if (!parts) {
    return {
      ok: false,
      problem: isContinue
        ? 'This is more than the writer model can read at once. Pick a model that can read more in Settings › Models, or shorten the style guide.'
        : 'That is more than the writer model can work on at once. Select fewer words, or pick a model that can read more in Settings › Models.'
    }
  }

  const user = parts.map((p) => p.text).join('\n\n')
  const blocks: ContextBlock[] = [
    {
      id: 'instructions',
      priority: 1,
      title: 'Instructions and style guide',
      text: system,
      tokens: estimateTokens(system),
      entryIds: [],
      dropped: false
    },
    ...parts.map((p) => ({
      id: p.id,
      priority: p.priority,
      title: p.title,
      text: p.text,
      tokens: estimateTokens(p.text),
      entryIds: p.entryIds,
      dropped: false
    }))
  ]
  const sent = new Set(parts.flatMap((p) => p.entryIds))
  const preset = CREATIVITY_PRESETS[CREATIVITY[tool]]
  return {
    ok: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    blocks,
    entries: [...sent].map((id) => ({ entryId: id, version: byId.get(id)?.updatedAt ?? '' })),
    reply,
    temperature: preset.temperature,
    topP: preset.top_p,
    note
  }
}

/** Fix voice can't go ahead: no dialogue, no one it can tell is speaking, or no one with a voice to match. */
function voiceProblem(lines: SpokenLine[], byId: Map<ID, EntryState>): EditBriefing | null {
  if (!lines.length) {
    return { ok: false, problem: 'There’s no dialogue in the selected words. Fix voice rewrites the words inside quotation marks.' }
  }
  const speakers = [...new Set(lines.map((l) => l.speakerId).filter((x): x is ID => !!x))].map((id) => byId.get(id)!)
  if (!speakers.length) {
    const which = lines.length === 1 ? 'this line' : 'these lines'
    return {
      ok: false,
      problem: `Couldn’t tell who says ${which}. Fix voice needs the speaker named nearby: in a speech tag such as “said Mara”, or in the same paragraph.`
    }
  }
  if (!speakers.some(hasVoice)) {
    const names = speakers.map((s) => s.name)
    const one = speakers.length === 1
    return {
      ok: false,
      problem: one
        ? `${names[0]} has no voice profile yet. Add how they speak or a few sample lines under Voice on ${names[0]}’s page, then try Fix voice again.`
        : `${joinAnd(names)} have no voice profiles yet. Add how they speak or a few sample lines under Voice on their pages, then try Fix voice again.`,
      entryId: speakers[0].id,
      entryName: speakers[0].name
    }
  }
  return null
}

/** What Fix voice found, in plain words: whose voices it fixes, and which lines it leaves alone. */
function voiceNote(lines: SpokenLine[], byId: Map<ID, EntryState>): string {
  const speakers = [...new Set(lines.map((l) => l.speakerId).filter((x): x is ID => !!x))].map((id) => byId.get(id)!)
  const voiced = speakers.filter(hasVoice).map((s) => s.name)
  const silent = speakers.filter((s) => !hasVoice(s)).map((s) => s.name)
  const unknown = lines.filter((l) => !l.speakerId).length
  const parts = [`Matching the ${voiced.length === 1 ? 'voice' : 'voices'} of ${joinAnd(voiced)}.`]
  if (silent.length)
    parts.push(`${joinAnd(silent)} ${silent.length === 1 ? 'has' : 'have'} no voice profile yet, so those lines stay as they are.`)
  if (unknown)
    parts.push(
      `${unknown === 1 ? 'One line' : `${unknown} lines`} with no clear speaker ${unknown === 1 ? 'stays' : 'stay'} as ${unknown === 1 ? 'it is' : 'they are'}.`
    )
  return parts.join(' ')
}
