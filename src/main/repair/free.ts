// Check and repair's free part (free rules, 2026-10-19): as new AI words land, before (and whatever comes of) the memory
// model's call, and even with no memory model or AI spending paused, the free rules over words read the new words alone,
// with no AI call:
// - a place named wrong (checks/placeNames.ts: the scene card's place called by another name of its kind) is mended in
//   place where that is safe (one card place of that kind, a swap of at most three words, the codex's name nowhere else
//   in the scene), only in a paragraph that is all the AI's own words, as one more of check and repair's small fixes (in
//   amber, with Undo); otherwise it is asked, with the swap to review;
// - a time claim that doesn't fit the story calendar (checks/timeClaims.ts) is asked, with the right month, weekday, year,
//   season or length to review where it is obvious.
// Each is kept under the rule-based checks' own key (checks/ruleChecks.ts ruleKey), so the rules' run after the memory
// reads the scene finds the same row rather than a second one, and one Adam ignored (or took back with Undo) is never
// asked or mended again. No Electron imports.

import type Database from 'better-sqlite3'
import type { RepairFix, RepairInput } from '@shared/contracts/repair'
import type { ID } from '@shared/types'
import * as cdb from '../db/checks'
import * as repo from '../db/repo'
import { plain } from '../keeper/text'
import { newId } from '../util'
import { freeContext } from '../checks/freeContext'
import { openingOf, placeRuleFindings, timeRuleFindings } from '../checks/freeRules'
import { placeFixWhy } from '../checks/placeNames'
import { ruleIssue } from '../checks/ruleChecks'
import { dreamlikeCard } from '../checks/rules'
import { allTheAis, newWordsOf } from './claims'

type DB = Database.Database

/** What the free rules found in new words: fixes to make in the page, and questions to ask. */
export interface FreeFound {
  fixes: { fix: RepairFix; issue: cdb.FoundIssue }[]
  questions: cdb.FoundIssue[]
}

const NONE: FreeFound = { fixes: [], questions: [] }

/** Where a place in the new words (newWordsOf) is: the paragraph and the character in its whole text. Null on a gap. */
function placeOf(paragraphs: RepairInput['paragraphs'], at: number): { para: number; offset: number } | null {
  let start = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const len = p.to - p.from
    if (at >= start && at <= start + len) return { para: i, offset: p.from + (at - start) }
    start += len + 2
  }
  return null
}

/**
 * The free rules over new words (see the top of this file). `aiText`: the record of the AI's words, so only words it
 * wrote are mended. Never throws: nothing found.
 */
export function freeFound(db: DB, input: RepairInput, storyId: ID, aiText: string): FreeFound {
  try {
    const newWords = newWordsOf(input.paragraphs)
    if (!newWords.trim() || !db.open) return NONE
    const ctx = freeContext(db, input.sceneId)
    if (!ctx) return NONE
    const card = repo.getScene(db, input.sceneId).card
    const scene = cdb.sceneTexts(db, [input.sceneId]).get(input.sceneId) ?? ''
    // The new words open the scene: how it opens is read too ("The next morning").
    const atStart = (input.beforeChars ?? 0) === 0 && (input.paragraphs[0]?.from ?? 0) === 0
    const time = ctx.time.date?.back || dreamlikeCard(card) ? [] : timeRuleFindings(newWords, ctx.time, atStart ? openingOf(newWords) : 0)
    const place = dreamlikeCard(card) ? { findings: [], slips: [] } : placeRuleFindings(newWords, ctx.place, scene)
    const ai = plain(aiText.replace(/\{[^{}\n]*\}/g, '').replace(/\*+/g, ''))
    const ours = input.paragraphs.map((p) => allTheAis(p, ai))
    const out: FreeFound = { fixes: [], questions: time.map((f) => ruleIssue(f, input.sceneId, storyId)) }
    place.findings.forEach((f, i) => {
      const slip = place.slips[i]
      const a = slip.safe ? placeOf(input.paragraphs, slip.start) : null
      const b = slip.safe ? placeOf(input.paragraphs, slip.end) : null
      const p = a ? input.paragraphs[a.para] : null
      const mendable = !!a && !!b && !!p && a.para === b.para && ours[a.para] && a.offset >= p.from && b.offset <= p.to && ai.includes(plain(slip.words))
      if (!mendable) {
        out.questions.push(ruleIssue(f, input.sceneId, storyId))
        return
      }
      const why = placeFixWhy(slip)
      out.fixes.push({
        fix: { id: newId(), para: a!.para, start: a!.offset, end: b!.offset, was: slip.words, now: slip.right, why },
        issue: { ...ruleIssue(f, input.sceneId, storyId), message: why }
      })
    })
    // Anything Adam said is meant (Ignore, or Undo on a mend) is neither asked nor mended again.
    const rows = cdb.rowsInScenes(db, [input.sceneId])
    const ignored = (f: cdb.FoundIssue): boolean => rows.some((r) => r.status === 'ignored' && cdb.sameThing({ ...f.payload, key: f.key }, r, f))
    return { fixes: out.fixes.filter((x) => !ignored(x.issue)), questions: out.questions.filter((q) => !ignored(q)) }
  } catch (e) {
    console.warn('Could not run the free checks over the new words', e)
    return NONE
  }
}

/** Raises the free rules' questions about new words at once; how many were new. Never throws. */
export function askFree(db: DB, sceneId: ID, questions: cdb.FoundIssue[]): number {
  if (!questions.length || !db.open) return 0
  try {
    return cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), questions, () => false)
  } catch (e) {
    console.warn('Could not keep what the free checks found in the new words', e)
    return 0
  }
}
