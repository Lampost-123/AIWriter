// Adam's own words (2026-10-19): which paragraphs of a scene he wrote or rewrote himself, and a sample of them for the
// writer's voice. Pure: the caller (style/ownWriting.ts) reads the scene and the AI's words for it from the database.
//
// How a paragraph is told apart: the app keeps every piece of text an AI wrote for a scene (the generation records'
// replies for drafts, beats, variants, Continue and the AI edits, the polish pass and the chapter writer's fixes, and the
// editor chat's proposed rewrites). A paragraph of the scene as it stands now is the AI's when its four-word runs are
// found there; Adam's own when few are (PARA_AI_SHARE) and no sentence of six words or more mostly is (SENTENCE_AI_SHARE),
// so a paragraph he wrote around one of the AI's sentences, left as it was, never counts. A paragraph of under four
// words is the AI's when its words stand together in the AI's text. A scene with no AI records at all is all his
// (typed, dictated, pasted or imported). Never counted as his: anything the AI wrote and he left unchanged, or changed
// only a little. Not told apart: text pasted in from somewhere else, or written with another AI, counts as his.

import type { ID } from '@shared/types'
import { OWN_SAMPLE } from '@shared/ownSample'
import { quoteSpans } from '../checks/speakers'
import { trimPassage } from '../ai/prompts'

/** Word runs of this many words are compared. */
export const GRAM = 4
/** A paragraph is Adam's own when under this share of its four-word runs is found in the AI's words. */
export const PARA_AI_SHARE = 0.25
/** ... and no sentence of at least SENTENCE_MIN_WORDS words has this share or more found there. */
export const SENTENCE_AI_SHARE = 0.6
export const SENTENCE_MIN_WORDS = 6
/** A stretch of his own shorter than this isn't a passage worth showing (a short line may still give variety). */
export const MIN_PASSAGE = 25
/** The shortest line of dialogue or narration added for variety. */
const MIN_VARIETY = 8

/** One paragraph of a scene, as read. */
export interface ParaRead {
  /** As the scene has it. */
  text: string
  /** Where it starts in the scene's text. */
  start: number
  words: number
  /** The share of its four-word runs found in the AI's words for the scene, 0 to 1. */
  aiShare: number
  /** Adam wrote or rewrote it himself: little of it is the AI's, and none of its sentences mostly is. */
  own: boolean
  /** It has a line of dialogue in it. */
  dialogue: boolean
  /** A scene break ("* * *"): never part of a sample. */
  isBreak: boolean
}

const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu

/** The words of a text, lower case, apostrophes made plain, punctuation and *italics* marks gone. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[’‘`´]/g, "'").match(WORD) ?? []
}

const countWords = (text: string): number => wordsOf(text).length

function gramsOf(w: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + GRAM <= w.length; i++) out.push(`${w[i]} ${w[i + 1]} ${w[i + 2]} ${w[i + 3]}`)
  return out
}

const BREAK = /^\s*(?:[*#~•·-]\s*){1,5}$/u

/** A scene's paragraphs (apart by a blank line, as the editor saves them), each with where it starts. */
export function splitParagraphs(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const re = /\n[^\S\n]*\n\s*/g
  let at = 0
  for (const m of text.matchAll(re)) {
    const end = m.index ?? 0
    if (text.slice(at, end).trim()) out.push({ text: text.slice(at, end), start: at })
    at = end + m[0].length
  }
  if (text.slice(at).trim()) out.push({ text: text.slice(at), start: at })
  return out
}

/** The sentences of a paragraph (rough: at . ! ? … and a closing mark after them). */
function sentencesOf(text: string): string[] {
  return text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu) ?? []
}

/**
 * The paragraphs of a scene's text, each with whether Adam wrote or rewrote it himself, given every text an AI wrote
 * for the scene (see the top of this file).
 */
export function readParagraphs(sceneText: string, aiTexts: readonly string[]): ParaRead[] {
  const paras = splitParagraphs(sceneText)
  const words = paras.map((p) => wordsOf(p.text))
  const ai = aiTexts.filter((t) => typeof t === 'string' && t.trim())
  // Only the runs the scene has are looked for in the AI's words, so a scene with many drafts needs no big set.
  const wanted = new Set<string>()
  for (const w of words) for (const g of gramsOf(w)) wanted.add(g)
  const found = new Set<string>()
  if (wanted.size) {
    for (const t of ai) {
      const w = wordsOf(t)
      for (let i = 0; i + GRAM <= w.length; i++) {
        const g = `${w[i]} ${w[i + 1]} ${w[i + 2]} ${w[i + 3]}`
        if (wanted.has(g)) found.add(g)
      }
    }
  }
  let joined: string | null = null
  const inAi = (w: readonly string[]): boolean => (joined ??= ` ${ai.map((t) => wordsOf(t).join(' ')).join(' | ')} `).includes(` ${w.join(' ')} `)
  const shareOf = (w: readonly string[]): number => {
    if (!w.length) return 0
    if (w.length < GRAM) return inAi(w) ? 1 : 0
    const g = gramsOf(w)
    return g.filter((x) => found.has(x)).length / g.length
  }
  return paras.map((p, i) => {
    const w = words[i]
    const isBreak = BREAK.test(p.text) || !w.length
    const dialogue = !isBreak && quoteSpans(p.text).length > 0
    if (isBreak) return { text: p.text, start: p.start, words: 0, aiShare: 0, own: false, dialogue: false, isBreak: true }
    if (!ai.length) return { text: p.text, start: p.start, words: w.length, aiShare: 0, own: true, dialogue, isBreak: false }
    const aiShare = shareOf(w)
    const aiSentence = sentencesOf(p.text).some((s) => {
      const sw = wordsOf(s)
      return sw.length >= SENTENCE_MIN_WORDS && shareOf(sw) >= SENTENCE_AI_SHARE
    })
    return { text: p.text, start: p.start, words: w.length, aiShare, own: aiShare < PARA_AI_SHARE && !aiSentence, dialogue, isBreak: false }
  })
}

/** A scene's paragraphs as read, with where the scene is in plain words ("Ch 3, Sc 2"). */
export interface OwnScene {
  sceneId: ID
  where: string
  paragraphs: ParaRead[]
}

/** One stretch of Adam's own writing in the sample. */
export interface OwnPassage {
  sceneId: ID
  where: string
  text: string
  words: number
  /** It has dialogue in it, and narration (a paragraph with no dialogue). */
  dialogue: boolean
  narration: boolean
}

/** Adam's own writing picked as the writer's voice sample, nearest scenes first. */
export interface OwnSample {
  passages: OwnPassage[]
  words: number
}

/** How many words of Adam's own the scenes hold, all told. */
export const ownWordsIn = (scenes: readonly OwnScene[]): number =>
  scenes.reduce((n, s) => n + s.paragraphs.reduce((m, p) => m + (p.own ? p.words : 0), 0), 0)

/**
 * Picks OWN_SAMPLE.target words (never more than max) of Adam's own writing, in stretches of at most perPassage words from
 * the scenes given nearest first: one stretch a scene first, so the sample comes from several scenes, each the stretch
 * with both dialogue and narration where there is one; then more while short of the target; then a line of dialogue or a
 * paragraph of narration if the sample has none. Null when there are fewer than OWN_SAMPLE.min words of his own: the
 * writer goes on as before. Deterministic: the same scenes give the same sample, so a provider can keep reusing it.
 */
export function pickOwnSample(scenes: readonly OwnScene[], o: { min: number; target: number; max: number; perPassage: number } = OWN_SAMPLE): OwnSample | null {
  if (ownWordsIn(scenes) < o.min) return null
  const used = scenes.map((s) => s.paragraphs.map(() => false))
  const picked: (OwnPassage & { at: [number, number[]] })[] = []
  let total = 0

  /** The best stretch of this scene's unused paragraphs of his own, of at most `cap` words (and at least `least`). */
  const best = (si: number, cap: number, least = MIN_PASSAGE): (OwnPassage & { at: [number, number[]] }) | null => {
    const s = scenes[si]
    const ps = s.paragraphs
    let top: { score: number; idx: number[]; text: string; words: number; dialogue: boolean; narration: boolean } | null = null
    for (let a = 0; a < ps.length; a++) {
      if (!ps[a].own || used[si][a]) continue
      const idx: number[] = []
      const texts: string[] = []
      let words = 0
      for (let b = a; b < ps.length && ps[b].own && !used[si][b]; b++) {
        if (words + ps[b].words > cap) {
          // A first paragraph longer than the room is cut at a sentence end.
          if (!idx.length) {
            const cut = trimPassage(ps[b].text.trim(), cap)
            idx.push(b)
            texts.push(cut)
            words = countWords(cut)
          }
          break
        }
        idx.push(b)
        texts.push(ps[b].text.trim())
        words += ps[b].words
      }
      if (!idx.length || words < least || words > cap) continue
      const dialogue = idx.some((i) => ps[i].dialogue)
      const narration = idx.some((i) => !ps[i].dialogue)
      // Both kinds first, then the longer stretch; ties go to the earlier one.
      const score = (dialogue && narration ? 2 : 0) + words / cap
      if (!top || score > top.score) top = { score, idx, text: texts.join('\n\n'), words, dialogue, narration }
    }
    if (!top) return null
    return { sceneId: s.sceneId, where: s.where, text: top.text, words: top.words, dialogue: top.dialogue, narration: top.narration, at: [si, top.idx] }
  }
  const add = (p: OwnPassage & { at: [number, number[]] }): void => {
    picked.push(p)
    total += p.words
    for (const i of p.at[1]) used[p.at[0]][i] = true
  }

  // One stretch a scene, nearest first; then more while short of the target.
  for (let round = 0; round < 3 && total < o.target; round++) {
    let added = false
    for (let si = 0; si < scenes.length && total < o.target; si++) {
      const room = Math.min(o.perPassage, o.max - total)
      if (room < MIN_PASSAGE) break
      const p = best(si, room)
      if (p) {
        add(p)
        added = true
      }
    }
    if (!added) break
  }

  // Variety: a line of dialogue, or a paragraph of narration, when the sample has none and he has written one.
  for (const kind of ['dialogue', 'narration'] as const) {
    if (!picked.length || picked.some((p) => p[kind])) continue
    for (let si = 0; si < scenes.length; si++) {
      const i = scenes[si].paragraphs.findIndex(
        (p, j) => p.own && !used[si][j] && (kind === 'dialogue' ? p.dialogue : !p.dialogue) && p.words >= MIN_VARIETY && p.words <= o.perPassage
      )
      if (i < 0) continue
      const para = scenes[si].paragraphs[i]
      const passage = {
        sceneId: scenes[si].sceneId,
        where: scenes[si].where,
        text: para.text.trim(),
        words: para.words,
        dialogue: para.dialogue,
        narration: !para.dialogue,
        at: [si, [i]] as [number, number[]]
      }
      if (total + para.words > o.max && picked.length > 1) {
        // No room: it takes the place of the last stretch picked, if what is left is still enough.
        const last = picked[picked.length - 1]
        if (total - last.words + para.words < o.min || total - last.words + para.words > o.max) break
        picked.pop()
        total -= last.words
        for (const j of last.at[1]) used[last.at[0]][j] = false
      }
      if (total + para.words <= o.max) add(passage)
      break
    }
  }

  if (total < o.min) return null
  return { passages: picked.map(({ at: _at, ...p }) => p), words: total }
}

/**
 * About `words` words of the sample to say again just above the closing instruction: the first stretch (the nearest
 * scene) that has both dialogue and narration, else the first, cut at a sentence end.
 */
export function echoOf(sample: OwnSample, words: number = OWN_SAMPLE.echo): OwnPassage | null {
  const first = sample.passages.find((p) => p.dialogue && p.narration) ?? sample.passages[0]
  if (!first) return null
  const text = trimPassage(first.text, words)
  return { ...first, text, words: countWords(text) }
}

/** The places the sample comes from, in plain words, each once, nearest first. */
export const sampleFrom = (sample: Pick<OwnSample, 'passages'>): string[] => [...new Set(sample.passages.map((p) => p.where).filter(Boolean))]
