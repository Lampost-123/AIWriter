// A continuity brief before each scene (long story memory fix 14, 2026-10-16). The writer's briefing is put together by
// fixed rules and caps, so a fact that matters for this scene can still miss the writer, and a big dump reads worse than
// a focused slice (NWM 2026: targeted records scored 0.89 against the full text; Chroma's "context rot"). Anthropic's
// advice for long work is a helper that reads widely and hands back a short brief, and InkOS's planner writes one per
// chapter. So the plan before writing (src/main/plan/), the memory model's call already made before each draft, also
// reads more than the writer could (the earlier chapters in short, the scene before and the scene so far word for word,
// what the story record says of everyone and everything here, and anything else it looks up: plan/brief.ts; the whole
// book so far until 2026-10-20) and writes a brief of about 1,000 to 2,000 tokens: what matters for this scene, what must
// not be contradicted (with where it was set), who knows what among those here, the promises in play and the time since
// key events.
//
// This file is the writer's side: the brief's parts, its block (a late one, right before the scene card, never left
// out: ai/context.ts), and which blocks give way to it so the briefing doesn't grow by saying things twice (the story so
// far and the earlier passages go short, and who knows what when the brief says it; what must stay true, the scene's
// contract and the scene card stay whole). Settings › Models, "Write a continuity brief before each scene" (on by
// default) turns it off; AIWRITE_BRIEF=off always does. Pure.

import type { Settings } from '@shared/types'
import { LEDGER_BLOCK } from './whoKnows'
import { MOST_SCALE } from './memoryRoom'

export const BRIEF_BLOCK = { id: 'continuity-brief', title: 'Continuity brief' } as const

/** The brief's parts, in the order the writer reads them. */
export const BRIEF_PARTS = ['matters', 'keep', 'knows', 'promises', 'time'] as const
export type BriefPart = (typeof BRIEF_PARTS)[number]

/** How each part is headed in the writer's block. */
export const BRIEF_TITLES: Record<BriefPart, string> = {
  matters: 'What matters for this scene',
  keep: 'What must not be contradicted',
  knows: 'Who knows what, among those here',
  promises: 'Promises in play',
  time: 'Time'
}

/** The brief as the writer gets it: each part's lines. */
export interface ContinuityBrief {
  parts: Partial<Record<BriefPart, string[]>>
}

/** What the block says first. */
export const BRIEF_LEAD =
  'Written just before this draft by a reader of the story record: what bears on this scene. Keep to it; it is for reference, not to retell.'

/** The short form keeps these parts: what matters, and what must not be contradicted. */
const SHORT_PARTS: readonly BriefPart[] = ['matters', 'keep']

const linesOf = (b: ContinuityBrief, part: BriefPart): string[] =>
  (b.parts[part] ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

/** True when the brief says anything at all. */
export const briefSays = (b: ContinuityBrief | null | undefined): b is ContinuityBrief =>
  !!b && BRIEF_PARTS.some((p) => linesOf(b, p).length > 0)

/** The block's text: the full form, or the short one (what matters and what must not be contradicted); '' for nothing. */
export function briefText(b: ContinuityBrief | null | undefined, short = false): string {
  if (!briefSays(b)) return ''
  const parts = BRIEF_PARTS.filter((p) => !short || SHORT_PARTS.includes(p))
    .map((p) => ({ p, lines: linesOf(b, p) }))
    .filter((x) => x.lines.length)
  if (!parts.length) return ''
  return [
    BRIEF_LEAD,
    ...parts.map((x) => `${BRIEF_TITLES[x.p]}:\n${x.lines.map((l) => `- ${l}`).join('\n')}`)
  ].join('\n\n')
}

/**
 * A brief read back from its block's text (a draft's record), as briefText wrote it (whatever its lead: one written before
 * 2026-10-20 says its reader read the book so far too); null when it holds none. The Context tab shows the last one
 * written for the scene (ai/draftFlow.ts previewBriefing).
 */
export function readBriefText(text: string | null | undefined): ContinuityBrief | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const byTitle = new Map<string, BriefPart>(BRIEF_PARTS.map((p) => [`${BRIEF_TITLES[p]}:`, p]))
  const parts: ContinuityBrief['parts'] = {}
  let at: BriefPart | null = null
  for (const raw of t.split('\n')) {
    const line = raw.trim()
    const part = byTitle.get(line)
    if (part) {
      at = part
      continue
    }
    if (at && line.startsWith('- ')) (parts[at] ??= []).push(line.slice(2).trim())
  }
  const brief: ContinuityBrief = { parts }
  return briefSays(brief) ? brief : null
}

/** Every part that may go short beside a brief (briefShortens). */
export const BRIEF_MAY_SHORTEN: readonly string[] = ['story-so-far', 'recalled', LEDGER_BLOCK.id]

/**
 * The blocks given in their short form when the writer has a brief (unless Adam chose Full for one in the Context tab),
 * so the briefing doesn't grow by saying things twice: the story so far (its older detail; the brief says what of it
 * bears on this scene), the earlier passages found by searching (the planner read every one found), and who knows what
 * when the brief has its own part for it (the short form still says what someone here doesn't know or believes wrongly).
 * What must stay true, the scene's contract and the scene card are never shortened for it. `earlierBooks`: the story has
 * earlier books (or side stories) on its line, which the brief's reader never read (it reads this story's chapters), so
 * the story so far, which tells them, stays whole (fix 14's review).
 */
export function briefShortens(b: ContinuityBrief | null | undefined, o: { earlierBooks?: boolean } = {}): string[] {
  if (!briefSays(b)) return []
  return BRIEF_MAY_SHORTEN.filter(
    (id) => (id !== LEDGER_BLOCK.id || linesOf(b, 'knows').length > 0) && (id !== STORY_SO_FAR || !o.earlierBooks)
  )
}

const STORY_SO_FAR = 'story-so-far'

/** True when a story has earlier books (or side stories added whole) on its line before this scene. */
export const hasEarlierBooks = (memory: { storySoFar?: { stories: unknown[] } | null }): boolean =>
  (memory.storySoFar?.stories.length ?? 0) > 0

/** The fewest tokens a brief is asked for, whatever the room. */
export const BRIEF_LEAST = 1_000

/** The most tokens the brief may take for the writer's room: 1,000 on the smallest writer models, growing to 2,000. */
export function briefTokens(scale: number): number {
  const f = Math.max(0, Math.min(1, ((scale || 1) - 1) / (MOST_SCALE - 1)))
  return BRIEF_LEAST + Math.round((f * 1_000) / 100) * 100
}

/**
 * How long the brief is asked to be: as much as the parts going short beside it free (`freed` tokens, plan/brief.ts
 * briefFrees), so the briefing doesn't grow, between BRIEF_LEAST and what the writer's room allows (briefTokens). Only a
 * story so short that little goes short gets a brief longer than what it frees, by BRIEF_LEAST at most.
 */
export function briefSize(scale: number, freed: number): number {
  return Math.max(BRIEF_LEAST, Math.min(briefTokens(scale), Math.floor(Math.max(0, freed) / 100) * 100))
}

/**
 * Whether drafts get a continuity brief: Adam's switch (Settings › Models, "Write a continuity brief before each scene",
 * on unless he turns it off), except that AIWRITE_BRIEF=off always turns it off (app tests that aren't about it). It is
 * written by the plan's call, so it needs Plan before writing too (plan/index.ts).
 */
export const briefWanted = (
  settings: Partial<Pick<Settings, 'continuityBrief'>>,
  env: Record<string, string | undefined> = process.env
): boolean => env.AIWRITE_BRIEF !== 'off' && settings.continuityBrief !== false
