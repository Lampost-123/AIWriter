// Adapted from mcreader-v2, src/lib/speech/speech.ts (its `prepare`, `readying`, `prefsFor`, `narrationArc` and
// `arcNote`; reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader decides each clip in
// the browser as it plays; here the main process plans a stretch of a scene at once and the window plays it.
//
// Everything decided about each clip before it is spoken: who says it (cast.ts, then the AI's marks), in which
// voice (the narrator's, the character's own, or the dialogue voice), how (the mark's note, else the dialogue tag:
// "she snapped" reads sharp), with which sounds, and with clear emphasis on the words in italics. Keep the
// narrator's voice steady reads narration plainly (only a mark's note, held gently), so only dialogue is acted.
import type { ClipRequest, PlannedClip, ReadParagraph } from '@shared/contracts/readAloud'
import type { SpeechSettings } from '@shared/types'
import { attributeRun, memberNamed, type Attribution, type CastMember, type SceneCast } from './cast'
import { cleanForSpeech } from './cleanText'
import { calmed, isStudioVoice, moodFor } from './emotion'
import { cueFor, tagSounds, withTag } from './perform'
import { sayAs, type SayRule } from './say'
import { looksLikeNote, NARRATOR, quoteKey, savedFor, spansIn, startsWithSpeaker, UNKNOWN } from './speakers'
import {
  quickStart,
  restBetween,
  sameMood,
  segmentParagraph,
  sentencesOf,
  stressed,
  withItalics,
  type NarrationNote,
  type Utterance
} from './segment'
import { clipKey } from './speak'
import type { LineDelivery, ParagraphMarks } from './types'

export type PlanSettings = Pick<
  SpeechSettings,
  'engine' | 'narratorVoice' | 'narratorDescription' | 'dialogueVoice' | 'style' | 'castVoices' | 'steadyNarrator' | 'sounds'
> &
  Partial<Pick<SpeechSettings, 'actFeelings' | 'checkWords'>>

export interface PlanInput {
  /** The paragraphs to read, the first from `offset`. */
  paragraphs: ReadParagraph[]
  /** The scene's paragraphs before them, for who is talking. */
  before?: ReadParagraph[]
  offset?: number
  /** A new reading: the first clip is one sentence. */
  quick?: boolean
  settings: PlanSettings
  cast: SceneCast
  lexicon: SayRule[]
  /** The marks kept for paragraphs whose words haven't changed, by paragraph id. */
  marks: Map<string, ParagraphMarks>
  /** Paragraphs the AI is noting now (Mark who says what): their clips wait for it, a reading's first narration aside. */
  marking?: Set<string>
  /** Paragraphs whose speakers the AI is marking now: their quotes the rules can't place wait for it. */
  labelling?: Set<string>
  /** Redo this line: which take each clip is read as, by its key as first planned (0 or none for the first). */
  takes?: (key: string) => number
}

/** How a speaker the AI named, or nobody, shows in the bar. */
const shownName = (label: string | undefined): string =>
  label && label !== UNKNOWN && label !== NARRATOR ? label.charAt(0).toUpperCase() + label.slice(1) : 'Someone'

const paced = (h: { tone?: string; pace?: string }): string =>
  [h.tone, h.pace === 'slow' ? 'slowly' : h.pace === 'fast' ? 'quickly' : h.pace === 'lively' ? 'a touch quicker' : ''].filter(Boolean).join(', ')

/** Words in a note that slow the voice right down. */
const SLOWING = /^(?:(?:very |quite )?slow(?:ly|er)?|unhurried(?:ly)?|measured|lingering|languid(?:ly)?|leisurely|deliberate(?:ly)?|drawn[- ]out|(?:with )?(?:long |many )?pauses|pausing)$/i

/**
 * The narrator never slows down (Adam, 2026-10-03: slowed narration is hard to listen to): a narration mark keeps its
 * feeling and tone, but not "slow" or the words in its note that would slow the voice. A quickening is kept, and the
 * characters' own lines keep their pace (a slow, halting line of dialogue says something about the speaker).
 */
export function narratorPace(how: LineDelivery | undefined): LineDelivery | undefined {
  if (!how) return how
  const tone = how.tone
    ?.split(/\s*,\s*/)
    .filter((w) => w && !SLOWING.test(w.replace(/[.]+$/, '').trim()))
    .join(', ')
  const out: LineDelivery = { ...how }
  if (tone) out.tone = tone
  else delete out.tone
  if (out.pace === 'slow') delete out.pace
  return out
}

/**
 * The marks on each sentence of a paragraph's narration, in order. A note that slipped there from a line of
 * dialogue when it was marked ("Adam, shaky, ...") is left out.
 */
function narrationNotes(para: string, marks: ParagraphMarks | undefined, cast?: SceneCast): NarrationNote[] {
  return spansIn(para)
    .filter((x) => !x.quote)
    .map((x) => {
      const how = savedFor(marks?.delivery, para.slice(x.at, x.end), true)
      return { at: x.at, end: x.end, how: cast && startsWithSpeaker(how?.tone, cast.all, cast.pov?.name) ? undefined : narratorPace(how) }
    })
}

/**
 * How a piece of narration is read, as marked: the note on the sentence it starts in, else on the last sentence
 * before it in the paragraph that has one, which carries on past the quotes between.
 */
function savedNarration(u: Utterance, notes: NarrationNote[]): LineDelivery | undefined {
  return notes
    .filter((x) => x.at <= u.from)
    .reverse()
    .find((x) => x.how?.tone || x.how?.pace)?.how
}

/** Turns one clip's note describes at most. */
const MAX_TURNS = 2

/** The notes across a piece of narration: the one it starts in, then each later sentence whose note is another mood. */
function narrationArc(u: Utterance, notes: NarrationNote[]): { at: number; how: LineDelivery }[] {
  const first = savedNarration(u, notes)
  if (!first) return []
  const out = [{ at: u.from, how: first }]
  for (const x of notes) {
    if (x.at <= u.from || x.at >= u.to || !(x.how?.tone || x.how?.pace)) continue
    if (!sameMood(out.at(-1)!.how, x.how) && out.length <= MAX_TURNS) out.push({ at: x.at, how: x.how })
  }
  return out
}

/**
 * Narration that changes mood partway through a clip, as one note in the form Breeze's guide writes a turn inside a
 * line: "Start hushed, dread building. At 'Then a door moved', shift to tight, holding its breath."
 */
function arcNote(para: string, arc: { at: number; how: LineDelivery }[]): string {
  return arc
    .map((a, k) => {
      if (!k) return `Start ${paced(a.how)}.`
      const sentence = /^[^.!?…]*/.exec(cleanForSpeech(para.slice(a.at)).replace(/["“”]/g, ''))![0]
      const words = sentence
        .split(/\s+/)
        .slice(0, 4)
        .join(' ')
        .replace(/[,;:—–-]+$/, '')
      return `At '${words}', shift to ${paced(a.how)}.`
    })
    .join(' ')
}

/** The voice for a clip: the narrator's; for a quote, its speaker's own, else the dialogue voice, else the narrator's. */
function voiceFor(quote: boolean, who: CastMember | null, s: PlanSettings): Pick<ClipRequest, 'voice' | 'voiceDesign' | 'instruct'> {
  if (!quote) return { voice: s.narratorVoice, voiceDesign: s.narratorDescription.trim(), instruct: s.style.trim() }
  // A line of dialogue drops the narrator's standing note, which describes a narrator, not the character.
  const own = s.castVoices ? who?.voice : undefined
  if (own?.voice) return { voice: own.voice, voiceDesign: '', instruct: '' }
  if (own?.design.trim()) return { voice: s.narratorVoice, voiceDesign: own.design.trim(), instruct: '' }
  if (s.dialogueVoice) return { voice: s.dialogueVoice, voiceDesign: '', instruct: '' }
  return { voice: s.narratorVoice, voiceDesign: s.narratorDescription.trim(), instruct: '' }
}

/** True when this character has a voice of their own that reading aloud would use. */
export const hasOwnVoice = (c: CastMember, s: Pick<PlanSettings, 'castVoices'>): boolean =>
  s.castVoices && !!(c.voice?.voice || c.voice?.design.trim())

/** Everything decided about one clip. */
function prepare(
  u: Utterance,
  found: Attribution | null,
  input: PlanInput,
  italics: [number, number][] | undefined
): Omit<PlannedClip, 'restMs' | 'waits'> & { known: boolean } {
  const s = input.settings
  const marks = input.marks.get(u.pid)
  const quote = u.role === 'other' && !!u.quote
  const quoteText = u.quote ? u.para.slice(u.quote.at, u.quote.at + u.quote.len) : ''
  // A speaker that is really a mood ("hushed, dread building") slipped there when the scene was marked: not kept.
  const marked = u.quote ? savedFor(marks?.speakers, quoteText) : undefined
  const slipped = !!marked && looksLikeNote(marked, input.cast.all)
  const label = slipped ? undefined : marked
  const how = quote && !slipped ? savedFor(marks?.delivery, quoteText) : undefined
  const notes = quote ? [] : narrationNotes(u.para, marks, input.cast)
  const told = quote || u.quote ? undefined : savedNarration(u, notes)

  // The words, with italics between asterisks so a written sound in italics ("*sighs*") is seen, and with the sounds
  // the marks put at the start of a sentence of narration (Perform written sounds).
  const sounds =
    s.sounds && !quote
      ? notes.filter((x) => x.how?.sound && x.at >= u.from && x.at < u.to).map((x) => ({ at: x.at, tag: x.how!.sound! }))
      : []
  const raw = sounds.length ? withSoundsAt(u, italics, sounds) : withItalics(u.para, italics, u.from, u.to)
  let text = cleanForSpeech(s.sounds ? tagSounds(raw) : raw)
  let direction: { delivery: string; pace: '' | 'slow' | 'fast' | 'lively'; gentle?: boolean } | null = null
  let shown = ''

  if (quote && how) {
    if (s.sounds && how.sound && u.from === u.quote!.at) text = withTag(text, how.sound)
    if (how.tone) direction = { delivery: how.tone, pace: how.pace ?? '' }
    else if (how.pace) direction = { delivery: '', pace: how.pace }
  }
  if (quote && !how?.tone) {
    // The dialogue tag, read without an AI call: "Mom snapped" is the line's tone, and "she sighed" a (sigh) at its start.
    const cue = cueFor(u.para, u.quote!.at, u.quote!.len)
    if (s.sounds && cue.tag && u.from === u.quote!.at && !how?.sound) text = withTag(text, cue.tag)
    if (!direction?.delivery && cue.delivery) direction = { delivery: cue.delivery, pace: direction?.pace ?? '' }
  }
  if (!quote && told) {
    const arc = narrationArc(u, notes)
    if (arc.length > 1) {
      direction = { delivery: arcNote(u.para, arc), pace: '' }
      shown = arc.map((a) => paced(a.how)).join(', then ')
    } else direction = { delivery: told.tone ?? '', pace: told.pace ?? '' }
  }
  // A hurried line is read only a touch quicker, its note's words for hurrying taken out (an arc keeps its own words).
  if (direction && !shown) {
    const kept = calmed(direction.delivery, direction.pace)
    direction = { ...direction, delivery: kept.tone, pace: kept.pace }
  }

  const who = quote ? (found?.who ?? null) : null
  let voice = voiceFor(quote, who, s)
  // A character with a studio voice reads the line from their own acted clip of its feeling (Act out feelings).
  const mood = quote && s.actFeelings !== false && isStudioVoice(voice.voice) && !voice.voiceDesign ? moodFor(direction?.delivery) : undefined
  // A steady narrator keeps one voice through the narration: no standing note, and a mark's note read gently.
  const steady = s.steadyNarrator && !quote
  if (steady) {
    direction = told && direction ? { ...direction, gentle: true } : null
    voice = { ...voice, instruct: '' }
  }
  const tone = direction ? shown || paced({ tone: direction.delivery, pace: direction.pace || undefined }) : ''
  // Words in italics get clear emphasis (Breeze's guide directs emphasis this way).
  const stress = stressed(u.para, italics, u.from, u.to)
  if (stress.length) {
    const on = `Put clear emphasis on ${stress.map((w) => `'${w}'`).join(' and ')}.`
    direction = direction
      ? { ...direction, delivery: direction.delivery ? `${direction.delivery.replace(/[.\s]+$/, '')}. ${on}` : on }
      : { delivery: on, pace: '', gentle: steady || undefined }
  }
  // Quote marks are not spoken, and a clip is already one voice's line.
  text = text
    .replace(/["“”]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const clip: ClipRequest = {
    input: sayAs(text, input.lexicon),
    ...voice,
    delivery: direction?.delivery ?? '',
    pace: direction?.pace ?? '',
    gentle: !!direction?.gentle,
    sounds: s.sounds,
    ...(mood ? { mood } : {}),
    ...(s.checkWords ? { check: true } : {})
  }
  // A line Adam asked to hear again is read as the take he heard last.
  const take = input.takes?.(clipKey(clip, s.engine)) ?? 0
  if (take > 0) clip.take = take
  return {
    key: clipKey(clip, s.engine),
    pid: u.pid,
    from: u.from,
    to: u.to,
    sentences: sentencesOf(u),
    who: quote ? (who?.name ?? shownName(label)) : 'Narrator',
    how: tone,
    clip,
    // Known when a tag says who it is, or the AI has been asked: a guess from a name nearby or from turns is checked.
    known: !quote || found?.how === 'tagged' || found?.how === 'label' || label !== undefined
  }
}

/** A narration clip's words with sound tags where its marks put them (italics kept between asterisks). */
function withSoundsAt(u: Utterance, italics: [number, number][] | undefined, at: { at: number; tag: string }[]): string {
  // Each stretch between two sounds keeps its italics; the tags go in front of the sentences they start.
  const cuts = [...new Set([u.from, ...at.map((x) => x.at), u.to])].sort((a, b) => a - b)
  let out = ''
  for (let i = 0; i < cuts.length - 1; i++) {
    const tag = at.find((x) => x.at === cuts[i])?.tag
    out += `${tag ? ` ${tag} ` : ''}${withItalics(u.para, italics, cuts[i], cuts[i + 1])}`
  }
  return out.trim()
}

/** A paragraph's marked speaker for a quote, as the run's rules take it: a cast member, null for someone else, undefined for none. */
function labelled(cast: SceneCast, name: string | undefined): CastMember | null | undefined {
  if (!name || name === UNKNOWN || name === NARRATOR || looksLikeNote(name, cast.all)) return undefined
  return memberNamed(cast.all, name)
}

/**
 * The clips for a stretch of a scene, in reading order: who says each one, in which voice and how, where it is on
 * the page, and the rest after it. `unplaced`: the quotes (by paragraph id, then the quote's key) that neither the
 * rules nor the AI's marks can give a speaker, in the run and the paragraphs before it.
 */
export function planClips(input: PlanInput): { clips: PlannedClip[]; unplaced: Map<string, Set<string>> } {
  const marking = input.marking ?? new Set<string>()
  const labelling = input.labelling ?? new Set<string>()
  const italicsOf = new Map<string, [number, number][] | undefined>()
  const split = (p: ReadParagraph, start: number): Utterance[] => {
    italicsOf.set(p.pid, p.italics)
    return segmentParagraph(p.pid, p.text, start, narrationNotes(p.text, input.marks.get(p.pid), input.cast))
  }
  const context = (input.before ?? []).flatMap((p) => split(p, 0))
  let run = input.paragraphs.flatMap((p, i) => split(p, i === 0 ? Math.max(0, input.offset ?? 0) : 0))
  if (input.quick) run = quickStart(run)
  // Who says each quote, over the whole run (and the paragraphs before it): a back-and-forth keeps its voices on
  // untagged lines. A quote the AI marked as nobody's words (a sign, a title) is read by the narrator.
  const all = [...context, ...run]
  // A speaker that is really a mood ("hushed, dread building") slipped there when it was marked: asked about again.
  const labels = all.map((u) => {
    const kept = u.quote ? savedFor(input.marks.get(u.pid)?.speakers, u.para.slice(u.quote.at, u.quote.at + u.quote.len)) : undefined
    return kept && looksLikeNote(kept, input.cast.all) ? undefined : kept
  })
  all.forEach((u, k) => {
    if (u.quote && labels[k] === NARRATOR) u.role = 'narrator'
  })
  const attributed = attributeRun(
    all.map((u, k) => ({
      block: u.pid,
      para: u.para,
      at: u.quote?.at ?? u.from,
      len: u.quote?.len ?? u.to - u.from,
      quote: u.role === 'other',
      label: labelled(input.cast, labels[k])
    })),
    input.cast
  )
  const unplaced = new Map<string, Set<string>>()
  all.forEach((u, k) => {
    // A quote the AI was asked about already (even when it couldn't tell) isn't asked about again, nor one a tag
    // names the speaker of. A guess from a name nearby or from turns is checked.
    if (u.role !== 'other' || !u.quote || attributed[k]?.how === 'tagged' || labels[k] !== undefined) return
    const key = quoteKey(u.para.slice(u.quote.at, u.quote.at + u.quote.len))
    if (key) (unplaced.get(u.pid) ?? unplaced.set(u.pid, new Set()).get(u.pid)!).add(key)
  })
  const found = attributed.slice(context.length)
  const clips: PlannedClip[] = []
  run.forEach((u, i) => {
    const p = prepare(u, found[i], input, italicsOf.get(u.pid))
    const quote = u.role === 'other'
    // What the AI is marking: a clip waits for it, except a new reading's first narration (it starts straight away).
    const noting = marking.has(u.pid) && !(i === 0 && input.quick && !quote)
    const naming = labelling.has(u.pid) && quote && !p.known
    const { known: _known, ...clip } = p
    const restMs = restBetween(u, run[i + 1])
    // Nothing a voice can say (an empty quote, a row of dashes): no clip, and its pause goes to the one before.
    if (!/[\p{L}\p{N}]/u.test(clip.clip.input)) {
      const before = clips.at(-1)
      if (before) before.restMs = Math.max(before.restMs, restMs)
      return
    }
    clips.push({ ...clip, restMs, waits: noting || naming })
  })
  return { clips, unplaced }
}
