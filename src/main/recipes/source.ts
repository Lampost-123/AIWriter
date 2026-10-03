// The story a recipe is made from, as kept in the recipe's own folder (source.json) while the recipe is made and
// after, so it can be read again (spec, "Story recipes"): its chapters, each with its scenes' paragraphs as plain
// text. Made from the import page's split (an ImportPlan). Also what the Recipe maker is told about each chapter
// that code can count exactly (words, scenes, how much is dialogue), so pacing never rests on the model's guess.
// Pure; no Electron.

import type { ImportPlan } from '@shared/contracts/importing'
import { countWords } from '@shared/defaults'

export interface SourceChapter {
  title: string
  /** Each scene's paragraphs; '' is a line across the page inside a scene. */
  scenes: string[][]
}

export interface RecipeSource {
  version: 1
  /** The story's own title. Kept only here, never shown in the library or sent as the recipe's name. */
  title: string
  chapters: SourceChapter[]
}

/** The plain text of an import plan: runs joined, empty scenes and chapters left out. */
export function sourceFromPlan(plan: ImportPlan): RecipeSource {
  const chapters: SourceChapter[] = []
  for (const c of plan.chapters ?? []) {
    const scenes = (c.scenes ?? [])
      .map((s) => (s.paragraphs ?? []).map((runs) => (runs ?? []).map((r) => r.text ?? '').join('').trim()))
      .filter((paras) => paras.some((p) => p))
    if (scenes.length) chapters.push({ title: (c.title ?? '').trim(), scenes })
  }
  return { version: 1, title: (plan.title ?? '').trim(), chapters }
}

/** A chapter as the model reads it: scenes split by "* * *". */
export function chapterText(c: SourceChapter): string {
  return c.scenes.map((s) => s.map((p) => (p ? p : '—')).join('\n\n')).join('\n\n* * *\n\n')
}

/** All of the story's text (for the checks against it). */
export const sourceText = (s: RecipeSource): string => s.chapters.map(chapterText).join('\n\n')

/** Words inside quotation marks: “…”, "…" and ‘…’ when they open after a space. */
const QUOTED = /“[^”]*”?|"[^"\n]*"?|(?:^|\s)‘[^’]*’/g

export interface ChapterStats {
  words: number
  scenes: number
  /** Share of the words that are dialogue, 0 to 1. */
  dialogue: number
}

export function chapterStats(c: SourceChapter): ChapterStats {
  let words = 0
  let spoken = 0
  for (const s of c.scenes) {
    for (const p of s) {
      words += countWords(p)
      for (const m of p.match(QUOTED) ?? []) spoken += countWords(m)
    }
  }
  return { words, scenes: c.scenes.length, dialogue: words ? Math.min(1, spoken / words) : 0 }
}

export const sourceWords = (s: RecipeSource): number => s.chapters.reduce((n, c) => n + chapterStats(c).words, 0)

/** How far through the story each chapter starts and ends, as whole percentages ("12%–19%"). */
export function chapterSpans(s: RecipeSource): { from: number; to: number }[] {
  const words = s.chapters.map((c) => chapterStats(c).words)
  const total = words.reduce((a, b) => a + b, 0) || 1
  let at = 0
  return words.map((w) => {
    const from = Math.round((at / total) * 100)
    at += w
    return { from, to: Math.round((at / total) * 100) }
  })
}

/** The pacing figures in plain words, one line a chapter, for the recipe's Pacing (counted, not guessed). */
export function pacingTable(s: RecipeSource): string {
  const spans = chapterSpans(s)
  return s.chapters
    .map((c, i) => {
      const st = chapterStats(c)
      return `Chapter ${i + 1} (${spans[i].from}%–${spans[i].to}%): ${st.words} words, ${st.scenes} ${st.scenes === 1 ? 'scene' : 'scenes'}, about ${Math.round(st.dialogue * 100)}% dialogue`
    })
    .join('\n')
}

/**
 * A chapter's text in pieces of at most `maxChars` characters, cut between paragraphs (a paragraph longer than
 * that is cut between sentences, then anywhere). One piece for a chapter that fits.
 */
export function piecesOf(text: string, maxChars: number): string[] {
  const most = Math.max(200, Math.floor(maxChars))
  if (text.length <= most) return [text]
  const paras = text.split(/\n\n/)
  const out: string[] = []
  let cur = ''
  const push = (): void => {
    if (cur.trim()) out.push(cur.trim())
    cur = ''
  }
  const add = (p: string): void => {
    if (cur && cur.length + p.length + 2 > most) push()
    cur = cur ? `${cur}\n\n${p}` : p
  }
  for (const p of paras) {
    if (p.length <= most) {
      add(p)
      continue
    }
    for (const sentence of p.match(/[^.!?]+[.!?]+["'’”)]*\s*|[^.!?]+$/g) ?? [p]) {
      if (sentence.length <= most) add(sentence.trim())
      else for (let i = 0; i < sentence.length; i += most) add(sentence.slice(i, i + most))
    }
  }
  push()
  return out
}
