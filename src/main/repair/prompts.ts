// What the memory model is told when it checks new words claim by claim (check and repair, step 3 of the consistency
// plan). Every line it may compare a claim with has an id the reply refers to:
//   W1...  where things stand just before the new words (the live stage), each value with the story's words for it:
//          each piece of clothing on its own line, and each thing in the place (step 2b)
//   E1...  the memory's entries named in the new words or on the scene card (looks, injuries, what they own...)
//   K1...  who knows what at the start of the scene
//   O1...  what the people here gave away, lost or got, however long ago (memory/items.ts), as it is now
//   D1...  who is dead by now
//   S1...  the scenes just before (when and where, who was there)
// The system prompt starts with "[AIWRITE-REPAIR v1]", so the fake provider in tests recognises it. Pure.

import type { ChatMessage, ContextBlock, ID } from '@shared/types'
import { clothesOf, pieceSource, STATE_FIELDS, STATE_LABELS, sourceKey, thingKey, thingsOf, type SceneState, type StateSource } from '@shared/continuity'
import { pieceText, thingText } from '@shared/stageItems'
import { deadBy } from '../ai/context'
import type { SceneCheckContext } from '../checks/context'
import { entryText, factsThatMatter, headsAt, holdingsHere } from '../checks/context'
import { estimateTokens } from '../keeper/text'
import { holdingLine, nameIn, namesOf } from '../memory/items'
import { isPerson, namesPerson } from '../ai/mustStay'

export const REPAIR_MARKER = '[AIWRITE-REPAIR v1]'

/**
 * One line of where things stand: a character's value (`who` set; each piece of clothing is its own 'wearing' line) or
 * the scene's time, weather or light, or a thing in the place ('thing').
 */
export interface StageLine {
  code: string
  who: string | null
  field: string
  value: string
  /** The story's own words that show it; null for a value with no words kept (Adam's own, say). */
  quote: string | null
  /** The quote is a whole one-line outfit's, shared by every piece read from it: never enough to mend without asking. */
  shared?: boolean
  /** The words are in the scene being checked (claims.ts: a thing put down here can't move off the page). */
  here?: boolean
}

/** One fact from the memory a claim may be compared with. */
export interface CodexLine {
  code: string
  kind: 'entry' | 'knows' | 'owns' | 'dead' | 'scene'
  /** The entry it is about (an E line; the item, for an O line), or the scene (an S line). */
  entryId?: ID
  sceneId?: ID
  label: string
}

/** The most entries told in full; more are told in a line or two each. */
const MOST_FULL = 8
/** The most facts listed under who knows what. */
const MOST_FACTS = 30
/** The most lines about what people here gave away, lost or got. */
const MOST_OWNED = 12

/**
 * Where things stand as lines with ids, each with its words: each piece of clothing, and each thing in the place, its
 * own. `sceneId`: the scene being checked, so a line whose words are in it says so (`here`).
 */
export function stageLines(stage: SceneState | null, sceneId?: ID): StageLine[] {
  if (!stage) return []
  const out: StageLine[] = []
  const said = stage.said ?? {}
  const add = (who: string | null, field: string, value: string, from: StateSource | undefined, shared = false): void => {
    if (!value.trim()) return
    const here = !!sceneId && from?.sceneId === sceneId
    out.push({ code: `W${out.length + 1}`, who, field, value: value.trim(), quote: from?.quote?.trim() || null, ...(shared ? { shared } : {}), ...(here ? { here } : {}) })
  }
  for (const f of ['time', 'weather', 'light'] as const) add(null, f, stage[f], said[sourceKey(null, f)])
  for (const c of stage.characters)
    for (const f of STATE_FIELDS) {
      add(c.name, f, c[f] ?? '', said[sourceKey(c.name, f)])
      // What they wear, piece by piece, right after where they are.
      if (f === 'where')
        for (const p of clothesOf(c)) {
          const from = pieceSource(said, c.name, p.name, clothesOf(c).length)
          add(c.name, 'wearing', pieceText(p), from, !!from?.line)
        }
    }
  for (const t of thingsOf(stage)) add(null, 'thing', thingText(t), said[thingKey(t.name)])
  return out
}

const FIELD_WORDS: Record<string, string> = {
  time: 'time',
  weather: 'weather',
  light: 'light',
  wearing: 'wearing',
  thing: 'thing in the place',
  ...STATE_LABELS
}

/** One stage line as the model reads it: `- [W2] Mara · wearing: hood off · words: "took off her hood"`. */
export const stageLineText = (l: StageLine): string =>
  `- [${l.code}] ${l.who ? `${l.who} · ` : ''}${FIELD_WORDS[l.field] ?? l.field}: ${l.value} · ${l.quote ? `words: "${l.quote}"` : 'no words kept'}`

/** The memory's lines a claim may be compared with, and their text for the request. */
export function codexLines(ctx: SceneCheckContext, newWords: string): { lines: CodexLine[]; sections: { id: string; title: string; text: string; entryIds: ID[] }[] } {
  const lines: CodexLine[] = []
  const sections: { id: string; title: string; text: string; entryIds: ID[] }[] = []
  // The entries the new words name (an item by its own main word too: "the compass"), and who the scene card puts there
  // (the E codes are the check context's own).
  const heads = headsAt(ctx.memory)
  const named = ctx.entries.filter((c) => c.why !== 'named in the scene' || namesOf(c.entry, heads).some((n) => nameIn(newWords, n)))
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
  // Who knows what: when there are more than the list holds, those about what the new words name and about the people
  // here are kept (factsThatMatter), not just the first in the memory's order.
  const facts = factsThatMatter(
    ctx.memory.facts,
    people.map((c) => c.entry),
    named.map((c) => c.entry),
    MOST_FACTS,
    heads
  )
  if (facts.length) {
    const text = facts.map((f, i) => {
      const code = `K${i + 1}`
      lines.push({ code, kind: 'knows', label: f.fact.trim() })
      const knows = people.filter((c) => f.knownBy.includes(c.entry.id)).map((c) => c.entry.name)
      // Never "not known by" someone the fact is about ("Ash will be at the Crown... Not known by: Ash"), as the
      // writer's own list has it (mustStay.ts realSecrets); nor an animal (isPerson).
      const not = people.filter((c) => !f.knownBy.includes(c.entry.id) && isPerson(c.entry) && !namesPerson(f.fact, c.entry)).map((c) => c.entry.name)
      return `- [${code}] ${f.fact.trim()} Known by: ${knows.join(', ') || 'none of them'}.${not.length ? ` Not known by: ${not.join(', ')}.` : ''}`
    })
    sections.push({ id: 'knowledge', title: 'Who knows what at the start of this scene (K ids)', text: text.join('\n'), entryIds: [] })
  }
  // What the people here gave away, lost or got, however long ago, as it is now (memory/items.ts; Adam, 2026-10-07: a
  // compass given away chapters before was taken out of a pocket, and nothing here said it had gone). The items the new
  // words name first. A slip against one of these is always a question, never mended (claims.ts: not a stage line).
  const owned = holdingsHere(
    ctx.memory,
    people.map((c) => c.entry.id),
    newWords
  ).slice(0, MOST_OWNED)
  if (owned.length) {
    const text = owned.map((h, i) => {
      const code = `O${i + 1}`
      lines.push({ code, kind: 'owns', entryId: h.itemId, label: h.item })
      return `- [${code}] ${holdingLine(h)}`
    })
    sections.push({ id: 'owned', title: 'What people here no longer have, or have now (O ids)', text: text.join('\n'), entryIds: [] })
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
You check newly written words of a novel, claim by claim, against what is already known, for the author. You are given where things stand just before the new words (each line with an id, W1..., and the story's own words that show it: where each person is and how they are placed, each piece of clothing on its own line, what they hold, who they touch and who they can see or hear, and each thing in the place), facts from the story's memory (E entries, K who knows what, O what people here gave away, lost or got, D who is dead, S the scenes just before), the words just before the new ones, and the new words. Reply with one JSON object and nothing else.

How to check
- Go through the new words one claim at a time: each place where they say, or take for granted, where someone is; how they are placed (standing, sitting, lying, on what); what they wear, item by item; what they hold or carry; who they touch; who they can see or hear; where a thing in the place is or how it is (a door shut, locked or barred; something put down somewhere; a lamp lit); an injury or how their body is; what they know; what they own; or the time of day and how much time has passed.
- For each claim, find the line it touches (a W, E, K, O, D or S id) and compare the two. Leave out claims that touch no line. Someone using, holding or carrying a thing an O line says they no longer have is a slip, unless the new words show them getting it back.
- The lines are where things stood BEFORE the new words. Anything the new words show happening first is fine, and so is anything that could have happened in between without being written: time passing, someone going somewhere, getting up, putting something down.
- "fits": the claim agrees with the line. "shown": the new words themselves show the change happening (she pulls her boots on, he gets up, someone tells her). "slip": the new words treat as already so something that cannot be true together with the line, and nothing in the new words or the words just before shows it changing: a boot back on with no words putting it on, a cup in a hand that put it down, a character knowing what they haven't learnt, a dead character acting.
- NOT a slip: a detail the line doesn't mention, or a more exact one (a man asleep sitting against a wall whose hand lies open on the floor: both can be true); someone somewhere else after time could have passed or they could have moved (a man last seen crossing the river home, later sitting by his own fire); a door opened or a thing moved when someone could have done it off the page (a door barred at dusk, open when someone walks in at midnight); who can see or hear whom changing as people move; anything the line leaves open. When unsure, it is not a slip.
- But a thing the words just before put down or set somewhere (a case set flat on the sill) that the new words have in a hand, on someone or somewhere else, with no words showing it picked up or moved, is a slip with "between": "nothing": within the same stretch of a scene nothing is picked up off the page.

Each claim:
{"quote": "", "who": "", "about": "where|posture|wearing|holding|touching|sees|thing|condition|knows|owns|time", "line": "W2", "verdict": "fits|shown|slip", "bothTrue": "no|yes|maybe", "between": "nothing|time|movement|action|unclear", "why": "", "fix": {"replace": "", "with": ""}, "question": ""}
- "quote": the shortest words that make the claim, copied exactly, character for character, from the new words.
- "who": the character's name, or "" for the time, weather or light, or a thing in the place.
- "bothTrue": could the claim and the line both be true at the same moment? "no" only for a plain contradiction (her pipe between her teeth, and the pipe in her hand); "yes" when they can (then it is no slip); "maybe" when you can't tell.
- "between": what could have happened between the line and the new words to explain it: "nothing" (the same moment, no gap), "time" (time has passed), "movement" (someone could have gone somewhere), "action" (something could have been done off the page), or "unclear".
- "why": for a slip, one plain sentence for the author, with names and no ids, such as "Mara took her boots off by the door, but here she walks out in them."
- "fix": only for a slip that is a plain contradiction ("bothTrue": "no", "between": "nothing") about something worn or held, a thing in the place, or an injury, mended by changing a few words in place without changing what happens (her pipe in her hand becomes her pipe between her teeth; his hat in his hands becomes his hat on his head). "replace": the fewest words that must change, at most six, copied exactly from the new words, inside or overlapping the quote; "with": those words changed as little as possible, in the same style. Never a fix that moves someone, changes who is where, or changes what happened (someone gone to the farrier for the night but seen in the yard is a question, not "had left word at the yard").
- "question": for any other slip, one short question for the author with the choices in it, such as "Tobin left for the docks earlier. Should he come back first, or is someone else waiting here?". Leave it out when "fix" mends the slip.

Reply with {"claims": [...]}, and {"claims": []} when the new words make no claim that touches a line.`
}

export interface RepairRequest {
  messages: ChatMessage[]
  blocks: ContextBlock[]
  entryIds: ID[]
}

/** The request: where things stand, the memory's facts, the scene card, the words just before, and the new words. */
export function repairRequest(o: {
  stage: StageLine[]
  codex: ReturnType<typeof codexLines>
  card: string
  leadIn: string
  newWords: string
}): RepairRequest {
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
