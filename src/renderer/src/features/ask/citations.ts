// Reading an answer from Ask the world. The model names what it used from the memory as [[Mara Venn]];
// each such name that is a page in the world becomes a link to it, and anything else in brackets stays
// plain words, so a link is never made up. Also takes out what models add despite being asked not to
// (bold, headings), and hides a name's brackets while it is still arriving. Pure, so it is unit-tested.

import type { EntryKind, ID } from '@shared/types'

/** A page an answer can link to. */
export interface LinkTarget {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
}

/** A run of an answer's text: plain words, or a cited name with the page it links to. */
export interface AnswerPart {
  text: string
  target: LinkTarget | null
}

/** Names compared as the reader sees them: case, spacing and curly quotes don't matter. */
const fold = (s: string): string => s.normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** Every page by its name and its other names. The first page with a name keeps it. */
export function nameIndex(targets: LinkTarget[]): Map<string, LinkTarget> {
  const byName = new Map<string, LinkTarget>()
  for (const t of targets) {
    for (const n of [t.name, ...t.aliases]) {
      const k = fold(n)
      if (k.length >= 2 && !byName.has(k)) byName.set(k, t)
    }
  }
  return byName
}

/** The page a cited name means: as written, or without "'s" at its end or "the" at its start. */
export function resolveName(name: string, index: Map<string, LinkTarget>): LinkTarget | null {
  const k = fold(name)
  if (!k) return null
  const tries = [k, k.replace(/'s$/, ''), k.replace(/^the /, ''), `the ${k}`]
  for (const t of tries) {
    const hit = index.get(t)
    if (hit) return hit
  }
  return null
}

/** Takes out bold and heading marks (asked for plain text, a model sometimes adds them anyway). */
export function tidyAnswer(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
}

const CITE = /\[\[([^[\]\n]{1,120}?)\]\]/g

/**
 * One paragraph's runs. "[[Name]]" (or "[[Name|shown words]]") links to the page called Name; a name
 * the world doesn't have is shown as plain words. A name still arriving ("[[Mar" at the very end)
 * shows without its brackets, and so does a lone "[" at the end.
 */
export function answerParts(text: string, index: Map<string, LinkTarget>): AnswerPart[] {
  const parts: AnswerPart[] = []
  const push = (t: string, target: LinkTarget | null): void => {
    if (!t) return
    const last = parts[parts.length - 1]
    if (!target && last && !last.target) last.text += t
    else parts.push({ text: t, target })
  }
  let at = 0
  for (const m of text.matchAll(CITE)) {
    push(text.slice(at, m.index), null)
    const [name, shown] = m[1].split('|', 2)
    const target = resolveName(name, index)
    push((shown ?? name).trim() || name.trim(), target)
    at = m.index + m[0].length
  }
  let rest = text.slice(at)
  const open = rest.lastIndexOf('[[')
  if (open >= 0 && !rest.slice(open).includes(']]') && !rest.slice(open).includes('\n')) rest = rest.slice(0, open) + rest.slice(open + 2)
  if (rest.endsWith('[')) rest = rest.slice(0, -1)
  push(rest, null)
  return parts
}

/** An answer as paragraphs of runs (split at blank lines; single line breaks stay within a paragraph). */
export function answerParagraphs(text: string, index: Map<string, LinkTarget>): AnswerPart[][] {
  return tidyAnswer(text)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => answerParts(p, index))
}

/** The pages an answer cites, in the order it first names them. */
export function citedTargets(text: string, index: Map<string, LinkTarget>): LinkTarget[] {
  const out: LinkTarget[] = []
  for (const m of text.matchAll(CITE)) {
    const t = resolveName(m[1].split('|', 2)[0], index)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** An answer as words to keep: names without their brackets, and none of the marks tidyAnswer takes out. */
export function plainAnswer(text: string): string {
  return tidyAnswer(text)
    .replace(CITE, (_m, inner: string) => {
      const [name, shown] = inner.split('|', 2)
      return (shown ?? name).trim() || name.trim()
    })
    .trim()
}
