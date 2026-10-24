// Under suggestion in the writer's briefing (ai/context.ts COMMANDS_BLOCK): for each person in the scene, the commands in
// effect as it begins (what they do, wear and feel, with the words and who gave them), what they wear by command, and the
// triggers waiting, so the writer keeps to them and sets a trigger off only on purpose. Short, for DeepSeek Flash.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { CommandView, PersonUnder } from '@shared/contracts/commands'
import { findName } from '@shared/names'
import { trackingOn } from '../db/commands'
import * as repo from '../db/repo'
import { peopleAt } from '.'

type DB = Database.Database

/** At most this many lines in the block. */
export const MOST_COMMAND_LINES = 12

export const COMMANDS_LEAD =
  'From the story so far: the hypnotic suggestions and commands people here are under, as this scene begins. What is in effect shows in what they do, wear and feel, unless this scene ends it. A waiting trigger does nothing until it happens: set one off only on purpose, when the scene card or direction calls for it, never by accident.'

const since = (c: CommandView): string => `since ${c.givenWhere}`

function inEffectLine(name: string, c: CommandView): string {
  const v = c.values
  const what = v.does || v.words
  const said = v.words && v.does ? `"${v.words}"` : ''
  const from = [said, c.giverName ? `from ${c.giverName}` : '', since(c)].filter(Boolean).join(', ')
  const lasts = v.lasts === 'scene' ? ' For this scene only.' : ''
  const feels = v.feels ? ` To ${name} it feels ${v.feels.replace(/^(?:like|as if)\b/i, (m) => m.toLowerCase())}.` : ''
  return `${name}: ${what} (${from}).${lasts}${feels}`
}

function waitingLine(name: string, c: CommandView): string {
  const v = c.values
  const who = v.triggerBy === 'giver' && c.giverName ? `only ${c.giverName} can set it off` : 'anyone can set it off'
  const times = v.every ? 'every time' : 'once, then it is used up'
  const fired = c.fired ? `; set off ${c.fired === 1 ? 'once' : `${c.fired} times`} so far` : ''
  return `${name}, waiting: when ${v.trigger}, ${v.does || v.words} (${who}; ${times}${fired}; planted ${since(c)}${c.giverName ? ` by ${c.giverName}` : ''}).`
}

/** The block's lines for the people given, those named first first. */
export function commandLines(people: PersonUnder[], presentIds: ID[]): string[] {
  const rank = new Map(presentIds.map((id, i) => [id, i]))
  const here = people.filter((p) => rank.has(p.entryId)).sort((a, b) => (rank.get(a.entryId) ?? 0) - (rank.get(b.entryId) ?? 0))
  const lines: string[] = []
  for (const p of here) {
    const holding = p.commands.filter((c) => c.inEffect)
    const cover = holding.find((c) => holding.some((o) => o.coveredBy === c.id))
    for (const c of holding) if (!c.coveredBy) lines.push(inEffectLine(p.name, c))
    if (p.wearing) {
      const under = holding.filter((c) => c.coveredBy).flatMap((c) => c.values.off)
      const still = cover && under.length ? `; under that, still: ${[...new Set(under)].map((x) => `no ${x}`).join(', ')}` : ''
      lines.push(`${p.name} wears, by command: ${p.wearing}${still}.`)
    }
    for (const c of p.commands) if (c.waiting) lines.push(waitingLine(p.name, c))
  }
  return lines.slice(0, MOST_COMMAND_LINES)
}

/**
 * The block's lines for a scene: as it begins, or as its words so far end when a draft carries on from them (`soFar`:
 * their commands are read with the scene). For those on its card first, then anyone under a command whom the card's
 * words or the scene so far name. Empty when the story isn't tracked.
 */
export function commandLinesFor(db: DB, sceneId: ID, o: { soFar?: string } = {}): string[] {
  try {
    const scene = repo.getScene(db, sceneId)
    const { story } = repo.sceneLocation(db, sceneId)
    if (!trackingOn(db, story.id)) return []
    const people = peopleAt(db, story.id, sceneId, { asItBegins: !o.soFar?.trim() }).people
    if (!people.length) return []
    const card = scene.card
    const words = [card.goal, card.conflict, card.outcome, card.notes, ...card.beats, o.soFar ?? ''].join('\n')
    const named = people.filter((p) => findName(words, p.name) || findName(words, p.name.split(/\s+/)[0])).map((p) => p.entryId)
    const ids = [...new Set([card.povId, ...(card.presentIds ?? []), ...named].filter((x): x is ID => !!x))]
    return commandLines(people, ids)
  } catch (e) {
    console.warn('Could not work out the commands for the briefing', e)
    return []
  }
}
