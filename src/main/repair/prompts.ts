// What the memory model is told when it checks new words claim by claim (check and repair, step 3 of the consistency
// plan). Every line it may compare a claim with has an id the reply refers to:
//   W1...  where things stand just before the new words (the live stage), each value with the story's words for it
//   E1...  the memory's entries named in the new words or on the scene card (looks, injuries, what they own...)
//   K1...  who knows what at the start of the scene
//   D1...  who is dead by now
//   S1...  the scenes just before (when and where, who was there)
// The system prompt starts with "[AIWRITE-REPAIR v1]", so the fake provider in tests recognises it. Pure.

import type { ChatMessage, ContextBlock, ID } from '@shared/types'
import { STATE_FIELDS, STATE_LABELS, sourceKey, type SceneState } from '@shared/continuity'
import { deadBy, mentions } from '../ai/context'
import type { SceneCheckContext } from '../checks/context'
import { entryText } from '../checks/context'
import { estimateTokens } from '../keeper/text'

export const REPAIR_MARKER = '[AIWRITE-REPAIR v1]'

/** One line of where things stand: a character's value (`who` set) or the scene's time, weather or light. */
export interface StageLine {
  code: string
  who: string | null
  field: string
  value: string
  /** The story's own words that show it; null for a value with no words kept (Adam's own, say). */
  quote: string | null
}

/** One fact from the memory a claim may be compared with. */
export interface CodexLine {
  code: string
  kind: 'entry' | 'knows' | 'dead' | 'scene'
  /** The entry it is about (an E line), or the scene (an S line). */
  entryId?: ID
  sceneId?: ID
  label: string
}

/** The most entries told in full; more are told in a line or two each. */
const MOST_FULL = 8
/** The most facts listed under who knows what. */
const MOST_FACTS = 30

/** Where things stand as lines with ids, each with its words. */
export function stageLines(stage: SceneState | null): StageLine[] {
  if (!stage) return []
  const out: StageLine[] = []
  const said = stage.said ?? {}
  const add = (who: string | null, field: string, value: string): void => {
    if (!value.trim()) return
    out.push({ code: `W${out.length + 1}`, who, field, value: value.trim(), quote: said[sourceKey(who, field)]?.quote?.trim() || null })
  }
  for (const f of ['time', 'weather', 'light'] as const) add(null, f, stage[f])
  for (const c of stage.characters) for (const f of STATE_FIELDS) add(c.name, f, c[f])
  return out
}

const FIELD_WORDS: Record<string, string> = { time: 'time', weather: 'weather', light: 'light', ...STATE_LABELS }

/** One stage line as the model reads it: `- [W2] Mara · wearing: hood off · words: "took off her hood"`. */
export const stageLineText = (l: StageLine): string =>
  `- [${l.code}] ${l.who ? `${l.who} · ` : ''}${FIELD_WORDS[l.field] ?? l.field}: ${l.value} · ${l.quote ? `words: "${l.quote}"` : 'no words kept'}`

/** The memory's lines a claim may be compared with, and their text for the request. */
export function codexLines(ctx: SceneCheckContext, newWords: string): { lines: CodexLine[]; sections: { id: string; title: string; text: string; entryIds: ID[] }[] } {
  const lines: CodexLine[] = []
  const sections: { id: string; title: string; text: string; entryIds: ID[] }[] = []
  // The entries the new words name, and who the scene card puts there (the E codes are the check context's own).
  const named = ctx.entries.filter(
    (c) => c.why !== 'named in the scene' || [c.entry.name, ...(c.entry.aliases ?? [])].some((n) => n.trim().length > 1 && mentions(newWords, n))
  )
  if (named.length) {
    for (const c of named) lines.push({ code: c.code, kind: 'entry', entryId: c.entry.id, label: c.entry.name })
    sections.push({
      id: 'memory',
      title: 'The memory as of the start of this scene (E ids)',
      text: named.map((c, i) => entryText(c, i >= MOST_FULL)).join('\n\n'),
      entryIds: named.map((c) => c.entry.id)
    })
  }
  const people = named.filter((c) => c.entry.kind === 'character' && !c.label)
  const ids = new Set(people.map((c) => c.entry.id))
  const facts = ctx.memory.facts.filter((f) => f.knownBy.some((id) => ids.has(id)) || people.some((c) => mentions(f.fact, c.entry.name))).slice(0, MOST_FACTS)
  if (facts.length) {
    const text = facts.map((f, i) => {
      const code = `K${i + 1}`
      lines.push({ code, kind: 'knows', label: f.fact.trim() })
      const knows = people.filter((c) => f.knownBy.includes(c.entry.id)).map((c) => c.entry.name)
      const not = people.filter((c) => !f.knownBy.includes(c.entry.id)).map((c) => c.entry.name)
      return `- [${code}] ${f.fact.trim()} Known by: ${knows.join(', ') || 'none of them'}.${not.length ? ` Not known by: ${not.join(', ')}.` : ''}`
    })
    sections.push({ id: 'knowledge', title: 'Who knows what at the start of this scene (K ids)', text: text.join('\n'), entryIds: [] })
  }
  const dead = deadBy(ctx.memory.entries)
  if (dead.length) {
    const text = dead.map((d, i) => {
      const code = `D${i + 1}`
      lines.push({ code, kind: 'dead', label: d.name, entryId: ctx.memory.entries.find((e) => e.name === d.name)?.id })
      return `- [${code}] ${d.name}: ${d.note}`
    })
    sections.push({ id: 'dead', title: 'Dead at the start of this scene (D ids)', text: text.join('\n'), entryIds: [] })
  }
  if (ctx.earlier.length) {
    for (const s of ctx.earlier) lines.push({ code: s.code, kind: 'scene', sceneId: s.sceneId, label: s.label })
    sections.push({
      id: 'earlier',
      title: 'The scenes just before this one (S ids)',
      text: ctx.earlier
        .map((s) => [`- [${s.code}] ${s.label}${s.title ? ` "${s.title}"` : ''}`, s.when ? `When: ${s.when}` : '', s.place ? `Where: ${s.place}` : '', s.present.length ? `Present: ${s.present.join(', ')}` : ''].filter(Boolean).join('. '))
        .join('\n'),
      entryIds: []
    })
  }
  return { lines, sections }
}

/** The instructions: the same every time, so providers that cache repeated prompts can reuse them. */
export function repairSystem(): string {
  return `${REPAIR_MARKER} claims
You check newly written words of a novel, claim by claim, against what is already known, for the author. You are given where things stand just before the new words (each line with an id, W1..., and the story's own words that show it), facts from the story's memory (E entries, K who knows what, D who is dead, S the scenes just before), the words just before the new ones, and the new words. Reply with one JSON object and nothing else.

How to check
- Go through the new words one claim at a time: each place where they say, or take for granted, where someone is; how they are placed (standing, sitting, lying, on what); what they wear, item by item; what they hold or carry; an injury or how their body is; what they know; what they own; or the time of day and how much time has passed.
- For each claim, find the line it touches (a W, E, K, D or S id) and compare the two. Leave out claims that touch no line.
- "fits": the claim agrees with the line. "shown": the new words themselves show the change happening (she pulls her boots on, he gets up, someone tells her). "slip": the new words treat as already so something that contradicts the line, and nothing in the new words or the words just before shows it changing: a boot back on with no words putting it on, someone standing who was lying down, a cup in a hand that put it down, a character knowing what they haven't learnt, a dead character acting.
- When unsure, it is not a slip.

Each claim:
{"quote": "", "who": "", "about": "where|posture|wearing|holding|condition|knows|owns|time", "line": "W2", "verdict": "fits|shown|slip", "why": "", "fix": {"replace": "", "with": ""}, "question": ""}
- "quote": the shortest words that make the claim, copied exactly, character for character, from the new words.
- "who": the character's name, or "" for the time, weather or light.
- "why": for a slip, one plain sentence for the author, with names and no ids, such as "Mara took her boots off by the door, but here she walks out in them."
- "fix": only for a slip that changing a few words in place mends without changing what happens (her hood up becomes her hood down; picks up her cup becomes reaches for her cup). "replace": the fewest words that must change, at most a dozen, copied exactly from the new words, inside or overlapping the quote; "with": those words changed as little as possible, in the same style. Leave "fix" out when mending it needs more than that, or a choice about the story.
- "question": for a slip "fix" can't mend, one short question for the author with the choices in it, such as "Tobin left for the docks earlier. Should he come back first, or is someone else waiting here?". Leave it out when "fix" mends the slip.

Reply with {"claims": [...]}, and {"claims": []} when the new words make no claim that touches a line.`
}

export interface RepairRequest {
  messages: ChatMessage[]
  blocks: ContextBlock[]
  entryIds: ID[]
}

/** The request: where things stand, the memory's facts, the scene card, the words just before, and the new words. */
export function repairRequest(o: { stage: StageLine[]; codex: ReturnType<typeof codexLines>; card: string; leadIn: string; newWords: string }): RepairRequest {
  const sections = [
    {
      id: 'stage',
      title: 'Where things stand just before the new words (W ids)',
      text: o.stage.length ? o.stage.map(stageLineText).join('\n') : 'Nothing is known yet about where things stand.',
      entryIds: [] as ID[]
    },
    ...o.codex.sections,
    ...(o.card.trim() ? [{ id: 'scene-card', title: 'The scene card', text: o.card.trim(), entryIds: [] as ID[] }] : []),
    ...(o.leadIn.trim()
      ? [{ id: 'lead-in', title: 'The words just before the new ones (already counted in where things stand; not to be checked)', text: `"""\n…${o.leadIn.trim()}\n"""`, entryIds: [] as ID[] }]
      : []),
    { id: 'new-words', title: 'The new words (check these)', text: `"""\n${o.newWords}\n"""`, entryIds: [] as ID[] }
  ]
  const user = sections.map((s) => `## ${s.title}\n${s.text}`).join('\n\n')
  const blocks: ContextBlock[] = sections.map((s, i) => ({
    id: s.id,
    priority: Math.min(10, i + 1),
    title: s.title,
    text: s.text,
    tokens: estimateTokens(s.text),
    entryIds: s.entryIds,
    dropped: false
  }))
  return {
    messages: [
      { role: 'system', content: repairSystem() },
      { role: 'user', content: user }
    ],
    blocks,
    entryIds: [...new Set(sections.flatMap((s) => s.entryIds))]
  }
}
