// Works out, before the memory model is asked anything, what a run has to do for one scene: which
// paragraphs are new or changed since the last read (by paragraph hash), where the words of each
// fact read from the scene are now (links follow their words when a paragraph moves or a typo is
// fixed), and which facts lost their words: edited (the model gives a verdict) or deleted (the fact
// goes, unless other words still support it). Since 2026-10-08 (World Memory Overhaul A1) a link left
// 'changed' by an earlier read is checked again at every read until it is settled: its fact is asked
// about again, and goes once its words are deleted. Reads only; nothing is written here. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID, SourceLink } from '@shared/types'
import type { KeeperScene } from '../db/keeper'
import { isFieldLink, linksForEntry, linksForFact } from '../db/history'
import { changesEndingIn } from '../db/memory'
import { factSaysSomething, sceneFacts, type SceneFact } from './facts'
import {
  closestSentence,
  diffParagraphs,
  findNearQuote,
  findQuote,
  mentionAt,
  onlyTypos,
  sceneParagraphs,
  type Para,
  type ParagraphDiff
} from './text'

type DB = Database.Database

/** Where a link's words are now: a paragraph id (or null, when ranges count in the scene's plain text) and a range. */
export interface Spot {
  paragraphId: string | null
  start: number
  end: number
  quote: string
}

/** A link whose words moved, were fixed, edited or deleted. */
export interface LinkMove {
  link: SourceLink
  /** Where its words are now; null when they are no longer there. */
  to: Spot | null
  state: SourceLink['state']
}

export interface ReadPlan {
  scene: KeeperScene
  /** The text version being read. */
  version: number
  paras: Para[]
  diff: ParagraphDiff
  /** New or changed paragraphs the memory model reads (typo fixes left out). */
  toRead: Para[]
  moves: LinkMove[]
  /**
   * Facts whose words were edited (at this read, or at an earlier one and still unsettled) and that nothing else
   * supports: they need the model's verdict. Their lost links come first.
   */
  atRisk: SceneFact[]
  /** Facts whose words were deleted and that nothing else supports: they go (Adam's are asked about). */
  gone: SceneFact[]
  /** Facts whose words are still in the scene (so the model doesn't add them again). */
  found: SceneFact[]
  /** Entries that lost some of their words in this scene (checked for "last mention gone" after the run). */
  touchedEntries: Set<ID>
  /** How many ends read from this scene (B1) have words that moved or went. */
  endsMoved?: number
}

/** Where a paragraph-relative range sits, as a link stores it. */
export function spotIn(p: Para, r: { start: number; end: number }): Spot {
  if (p.pid) return { paragraphId: p.pid, start: r.start, end: r.end, quote: p.text.slice(r.start, r.end) }
  const base = p.offset ?? 0
  return { paragraphId: null, start: base + r.start, end: base + r.end, quote: p.text.slice(r.start, r.end) }
}

/** Finds a link's words in the scene: in its own paragraph first (allowing a typo fix), then anywhere. */
export function relocate(link: Pick<SourceLink, 'paragraphId' | 'quote'>, paras: Para[]): Spot | null {
  const own = link.paragraphId ? paras.find((p) => p.pid === link.paragraphId) : undefined
  if (own) {
    const r = findQuote(own.text, link.quote) ?? findNearQuote(own.text, link.quote)
    if (r) return spotIn(own, r)
  }
  for (const p of paras) {
    const r = findQuote(p.text, link.quote)
    if (r) return spotIn(p, r)
  }
  for (const p of paras) {
    const r = findNearQuote(p.text, link.quote)
    if (r) return spotIn(p, r)
  }
  return null
}

/** True when the words were edited rather than deleted: their paragraph is still there, or a changed one is much like them. */
function wasEdited(link: SourceLink, paras: Para[], changed: Para[]): boolean {
  if (link.paragraphId && paras.some((p) => p.pid === link.paragraphId)) return true
  const best = closestSentence(changed.map((p) => p.text).join('\n'), link.quote)
  return !!best && best.score >= 0.5
}

/**
 * For a link already marked changed at an earlier read: true while its words still look edited rather than deleted
 * (its paragraph is still there, or some sentence in the scene is much like them: its paragraph may have been joined to
 * another).
 */
function stillEdited(link: SourceLink, paras: Para[]): boolean {
  if (link.paragraphId && paras.some((p) => p.pid === link.paragraphId)) return true
  const best = closestSentence(paras.map((p) => p.text).join('\n'), link.quote)
  return !!best && best.score >= 0.5
}

/** True when the words are where the link says (its scene version stays the one they were read from). */
const sameSpot = (l: SourceLink, s: Spot): boolean =>
  l.paragraphId === s.paragraphId && l.start === s.start && l.end === s.end && l.quote === s.quote

/** A mention of the entry's name or one of its other names in the scene, or null. */
export function findMention(names: string[], paras: Para[]): Spot | null {
  for (const p of paras) {
    for (const n of names) {
      const r = mentionAt(p.text, n)
      if (r) return spotIn(p, r)
    }
  }
  return null
}

/** True when the fact has words that support it outside the links given (in this scene or any other). */
function supportedElsewhere(db: DB, f: SceneFact, lost: Set<ID>): boolean {
  const links =
    f.kind === 'change'
      ? linksForFact(db, 'change', f.change.id)
      : f.kind === 'field'
        ? linksForEntry(db, f.entry.id).filter((l) => isFieldLink(l, f.field))
        : f.kind === 'voice'
          ? []
          : linksForEntry(db, f.entry.id).filter((l) => l.factKind === 'entry')
  return links.some((l) => l.state === 'ok' && !lost.has(l.id))
}

/** What a run of this scene has to do, before asking the memory model. */
export function planRead(db: DB, scene: KeeperScene): ReadPlan {
  const version = scene.textVersion
  const paras = sceneParagraphs(scene.doc, scene.text)
  const diff = diffParagraphs(scene.read, paras)
  const toRead = diff.changed.filter((p) => !(p.pid && diff.before.has(p.pid) && onlyTypos(diff.before.get(p.pid)!, p.text)))

  const facts = sceneFacts(db, scene.sceneId)
  const moves: LinkMove[] = []
  const lost = new Set<ID>()
  const lostFacts = new Map<string, { fact: SceneFact; edited: boolean; links: SourceLink[] }>()
  const touchedEntries = new Set<ID>()
  const lose = (f: SceneFact, l: SourceLink, edited: boolean): void => {
    lost.add(l.id)
    touchedEntries.add(f.kind === 'change' ? f.change.entryId : f.entry.id)
    const prev = lostFacts.get(f.key)
    lostFacts.set(f.key, { fact: f, edited: edited || !!prev?.edited, links: [...(prev?.links ?? []), l] })
  }

  for (const f of facts) {
    for (const l of f.links) {
      // An entry is still mentioned if any of its names is (as a whole word): the link moves to that mention.
      const to =
        f.kind === 'entry'
          ? findMention([l.quote, f.entry.name, ...f.entry.aliases], [...paras.filter((p) => p.pid && p.pid === l.paragraphId), ...paras])
          : relocate(l, paras)
      if (to) {
        if (l.state !== 'ok' || !sameSpot(l, to)) moves.push({ link: l, to, state: 'ok' })
        continue
      }
      if (l.state === 'gone') continue
      if (l.state === 'changed') {
        // Edited at an earlier read and not settled since (World Memory Overhaul A1, 2026-10-08): its words may have
        // been deleted meanwhile (then it is gone, and the fact goes as below); otherwise the fact is asked about again.
        const edited = stillEdited(l, paras)
        if (!edited) moves.push({ link: l, to: null, state: 'gone' })
        if (factSaysSomething(f) || !edited) lose(f, l, edited)
        continue
      }
      // The words were there at the last read and aren't now.
      const edited = wasEdited(l, paras, diff.changed)
      moves.push({ link: l, to: null, state: edited ? 'changed' : 'gone' })
      lose(f, l, edited)
    }
  }

  const atRisk: SceneFact[] = []
  const gone: SceneFact[] = []
  for (const { fact, edited, links } of lostFacts.values()) {
    if (fact.kind === 'entry') continue // checked as a whole after the run (last mention gone)
    if (fact.kind !== 'voice' && supportedElsewhere(db, fact, lost)) continue
    // The words it lost come first, so its request line and its verdict are about them.
    if (edited && fact.kind !== 'voice') atRisk.push({ ...fact, links: [...links, ...fact.links.filter((l) => !links.includes(l))] })
    else gone.push(fact)
  }
  // A fact whose words were edited is read with its paragraph, even when the edit looked like a typo fix.
  for (const f of atRisk) {
    for (const l of f.links) {
      const p = l.paragraphId ? paras.find((x) => x.pid === l.paragraphId) : undefined
      if (p && !toRead.includes(p)) toRead.push(p)
    }
  }
  toRead.sort((a, b) => paras.indexOf(a) - paras.indexOf(b))
  const risky = new Set([...atRisk, ...gone].map((f) => f.key))
  const okAfter = (l: SourceLink): boolean => {
    const m = moves.find((x) => x.link.id === l.id)
    return m ? m.state === 'ok' : l.state === 'ok'
  }
  const found = facts.filter((f) => !risky.has(f.key) && f.links.some(okAfter))
  // Ends read from this scene (B1) whose words moved or went: the run settles them (keeper/apply.ts settleEnds).
  const endsMoved = changesEndingIn(db, scene.sceneId).filter((c) => {
    const u = c.until
    if (!u || u.origin !== 'text' || !u.quote) return false
    const to = relocate({ paragraphId: u.paragraphId, quote: u.quote }, paras)
    return !to || to.quote !== u.quote || to.paragraphId !== u.paragraphId
  }).length
  return { scene, version, paras, diff, toRead, moves, atRisk, gone, found, touchedEntries, endsMoved }
}

/** True when a run would change nothing: no new words to read and no fact (or end) lost or moved its words. */
export const nothingToDo = (p: ReadPlan): boolean =>
  !p.toRead.length && !p.moves.length && !p.atRisk.length && !p.gone.length && !p.endsMoved
