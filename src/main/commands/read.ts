// Under suggestion: reading a scene for hypnotic suggestions and commands, with the memory model, in a call of its own
// (the memory keeper's reading prompt is full: keeper/prompts.ts holds it under 6,000 characters). Only for a story Adam
// turned tracking on for; after the keeper reads a scene (keeper/index.ts standLater) and, when he turns it on, for the
// scenes already written (reader.ts). The request is short for DeepSeek Flash: the people (E lines), the commands as the
// scene begins (C lines) and the scene. A scene read again puts its new steps in place of its old unanswered ones; Adam's
// own steps and his answers stay, and a step he said no to isn't brought back.
import type Database from 'better-sqlite3'
import type { ChatMessage, ID } from '@shared/types'
import type { CommandStepKind, CommandValues, CommandView, PersonUnder } from '@shared/contracts/commands'
import { findName } from '@shared/names'
import * as repo from '../db/repo'
import * as store from '../db/commands'
import { parseLenient } from '../keeper/json'
import { estimateTokens, hashText } from '../keeper/text'
import { callModel, type MemoryModel } from '../keeper/model'
import { cleanValues, EMPTY_VALUES } from '../memory/commands'
import { peopleAt } from '.'

type DB = Database.Database

/** Room for the reply: a few steps, each short. */
export const COMMANDS_REPLY = 1_500
/** At most this many people are listed. */
const MOST_PEOPLE = 40
/** Bumped when the request changes, so every scene is read again with the new one. */
export const COMMANDS_RULES = 1

export const COMMANDS_SYSTEM = `You read one scene of a story and report hypnotic suggestions and commands: anything put into someone's mind under hypnosis, trance, conditioning or a similar hold, that they then follow. Not ordinary requests, orders or promises.
Reply with JSON only: {"steps":[...]}, or {"steps":[]} when there are none.
A step: {"step":"given|stronger|changed|fired|resisted|ended","c":"C1","who":"E1","by":"E2","words":"what was said, short","does":"what it makes them do, plain words","kind":"clothing|feeling|action|forget|other","off":["each piece of clothing it keeps off"],"all":false,"trigger":"what sets it off, or empty","trigger_by":"anyone|giver","every":false,"lasts":"story|scene","feels":"how it feels to them","quote":"words copied from the scene","sure":true}
- given: a new command (no "c"). One planted for later, with a trigger, is given with its trigger: it changes nothing yet.
- fired: the trigger of a listed command happens here and they obey it. resisted: it happens and they don't.
- stronger or changed: a listed command is deepened or altered. Give "c" and only the fields that change.
- ended: a listed command is lifted, cancelled or wears off. Give "c".
- One step a command: "no socks" and "no bra" are two. A new command never ends another unless the scene says so.
- all: true only when it keeps every piece of clothing off. every: true when the trigger works each time.
- lasts: "scene" when it holds only for now. who and by are E ids; by is null when not known.
- quote: under 25 words, word for word. sure: false when the scene leaves it unclear.`

export interface Person {
  id: ID
  name: string
  aliases: string[]
}

/**
 * The people a scene's reading lists, in this order: those on its card, anyone under or giving a command so far, then
 * those its words name, by where they first appear.
 */
export function castOf(text: string, everyone: Person[], o: { card: ID[]; under: PersonUnder[] }): Person[] {
  const byId = new Map(everyone.map((p) => [p.id, p]))
  const want: ID[] = [...o.card]
  for (const p of o.under) {
    want.push(p.entryId)
    for (const c of p.commands) if (c.giverId) want.push(c.giverId)
  }
  const named = everyone
    .map((p) => {
      const names = [p.name, ...p.aliases, p.name.split(/\s+/)[0]].filter((n) => n.trim().length > 1)
      const at = Math.min(...names.map((n) => findName(text, n)?.start ?? Infinity))
      return { id: p.id, at }
    })
    .filter((x) => x.at < Infinity)
    .sort((a, b) => a.at - b.at)
  want.push(...named.map((x) => x.id))
  return [...new Set(want)].flatMap((id) => byId.get(id) ?? []).slice(0, MOST_PEOPLE)
}

const quoted = (s: string): string => `"${s.replace(/"/g, "'")}"`

/** A command as a C line: who, from whom, what, and how it stands as the scene begins. */
export function commandLine(c: CommandView, label: string, eOf: (id: ID) => string): string {
  const v = c.values
  const parts = [`${label} ${eOf(c.subjectId)} ${c.subjectName}${c.giverId ? ` <- ${eOf(c.giverId)} ${c.giverName ?? ''}`.trimEnd() : ''}: ${quoted(v.words || v.does)}`]
  if (v.does && v.words) parts.push(`does: ${v.does}`)
  if (v.trigger) parts.push(`trigger: ${v.trigger} (${v.triggerBy === 'giver' ? 'only the giver' : 'anyone'}, ${v.every ? 'every time' : 'once'})`)
  parts.push(c.status === 'waiting' ? 'waiting for its trigger' : c.status === 'in-effect' ? 'in effect' : 'over')
  return parts.join(' · ')
}

export interface CommandsRequest {
  messages: ChatMessage[]
  /** E label to entry id, C label to command id. */
  ids: { people: Map<string, ID>; commands: Map<string, ID> }
  /** What the request was made from: the scene's words, its people and the commands before (changes mean a new read). */
  hash: string
}

export function commandsRequest(text: string, cast: Person[], before: PersonUnder[]): CommandsRequest {
  const people = new Map<string, ID>()
  const eLabel = new Map<ID, string>()
  cast.forEach((p, i) => {
    people.set(`E${i + 1}`, p.id)
    eLabel.set(p.id, `E${i + 1}`)
  })
  const eOf = (id: ID): string => eLabel.get(id) ?? 'E?'
  const commands = new Map<string, ID>()
  const lines: string[] = []
  // Over ones aren't listed: nothing in a scene can change them (an end is for good).
  const open = before.flatMap((p) => p.commands).filter((c) => c.status !== 'ended')
  open.forEach((c, i) => {
    commands.set(`C${i + 1}`, c.id)
    lines.push(commandLine(c, `C${i + 1}`, eOf))
  })
  const user = [
    'People:',
    ...cast.map((p) => `${eOf(p.id)} ${p.name}${p.aliases.length ? ` (also ${p.aliases.slice(0, 3).join(', ')})` : ''}`),
    '',
    'Commands as the scene begins:',
    ...(lines.length ? lines : ['none']),
    '',
    'The scene:',
    text
  ].join('\n')
  const hash = hashText(JSON.stringify([COMMANDS_RULES, user]))
  return { messages: [{ role: 'system', content: COMMANDS_SYSTEM }, { role: 'user', content: user }], ids: { people, commands }, hash }
}

export interface ReadStep {
  kind: CommandStepKind
  /** A listed command, for anything but 'given'. */
  commandId: ID | null
  subjectId: ID | null
  giverId: ID | null
  values: Partial<CommandValues>
  quote: string
  unsure: boolean
}

const STEPS: CommandStepKind[] = ['given', 'stronger', 'changed', 'fired', 'resisted', 'ended']
const norm = (s: string): string => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()

/** The reply's steps, with only what can be used: a given step needs who and what; the rest need a listed command. */
export function readCommandsReply(value: unknown, ids: CommandsRequest['ids'], text: string): ReadStep[] {
  const raw = value && typeof value === 'object' ? (value as { steps?: unknown }).steps : null
  if (!Array.isArray(raw)) return []
  const plainText = norm(text)
  const out: ReadStep[] = []
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = STEPS.find((k) => k === String(o.step ?? '').trim().toLowerCase())
    if (!kind) continue
    const person = (v: unknown): ID | null => (typeof v === 'string' ? (ids.people.get(v.trim().toUpperCase()) ?? null) : null)
    const commandId = typeof o.c === 'string' ? (ids.commands.get(o.c.trim().toUpperCase()) ?? null) : null
    const values = cleanValues({ ...o, triggerBy: o.trigger_by ?? o.triggerBy })
    const quote = typeof o.quote === 'string' ? o.quote.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    // A quote that isn't in the scene's words is a guess: kept, but as something the memory isn't sure of.
    const found = !!quote && plainText.includes(norm(quote))
    const unsure = o.sure === false || o.sure === 'false' || !found
    if (kind === 'given') {
      const subjectId = person(o.who)
      if (!subjectId || (!values.words && !values.does)) continue
      out.push({ kind, commandId: null, subjectId, giverId: person(o.by), values, quote: found ? quote : '', unsure })
    } else {
      if (!commandId) continue
      const keep = kind === 'stronger' || kind === 'changed' ? values : {}
      if ((kind === 'stronger' || kind === 'changed') && !Object.keys(keep).length) continue
      out.push({ kind, commandId, subjectId: null, giverId: null, values: keep, quote: found ? quote : '', unsure })
    }
  }
  return out
}

const sameWords = (a: Partial<CommandValues>, b: Partial<CommandValues>): boolean => {
  const x = norm(a.words || a.does || '')
  const y = norm(b.words || b.does || '')
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

/**
 * Keeps a reading of a scene: its old unanswered steps go, the new ones come in, except any Adam already answered
 * (the same command and kind here, or for a new one the same person and words).
 */
export function keepReading(db: DB, sceneId: ID, storyId: ID, steps: ReadStep[], hash: string): void {
  db.transaction(() => {
    store.clearReadSteps(db, sceneId)
    const answered = store.stepsInScene(db, sceneId).filter((s) => s.origin === 'ai')
    const commands = new Map(answered.map((s) => [s.commandId, store.getCommand(db, s.commandId)]))
    steps.forEach((s, seq) => {
      if (s.kind === 'given') {
        const dup = answered.some((a) => a.kind === 'given' && commands.get(a.commandId)?.subjectId === s.subjectId && sameWords(a.values, s.values))
        if (dup || !s.subjectId) return
        const id = store.insertCommand(db, { storyId, subjectId: s.subjectId, giverId: s.giverId, origin: 'ai' })
        store.insertStep(db, { commandId: id, sceneId, kind: 'given', values: { ...EMPTY_VALUES, ...s.values }, quote: s.quote, note: '', origin: 'ai', unsure: s.unsure, seq })
      } else if (s.commandId) {
        if (answered.some((a) => a.commandId === s.commandId && a.kind === s.kind)) return
        store.insertStep(db, { commandId: s.commandId, sceneId, kind: s.kind, values: s.values, quote: s.quote, note: '', origin: 'ai', unsure: s.unsure, seq })
      }
    })
    store.setReadHash(db, sceneId, hash)
  })()
}

export type ReadOutcome = 'read' | 'unchanged' | 'off' | 'failed' | 'stopped'

/**
 * Reads one scene for commands, if its story is tracked and the scene changed since it was last read (its words, its
 * people or the commands before it). Never throws.
 */
export async function readSceneCommands(db: DB, sceneId: ID, model: MemoryModel, o: { signal?: AbortSignal; closed: () => boolean; fetchImpl?: typeof fetch }): Promise<ReadOutcome> {
  try {
    const scene = repo.getScene(db, sceneId)
    const { story } = repo.sceneLocation(db, sceneId)
    if (!store.trackingOn(db, story.id)) return 'off'
    const text = scene.text.trim()
    const before = peopleAt(db, story.id, sceneId, { asItBegins: true }).people
    if (!text) {
      if (store.stepsInScene(db, sceneId).some((s) => s.origin === 'ai')) keepReading(db, sceneId, story.id, [], '')
      return 'unchanged'
    }
    const everyone = repo
      .listEntries(db)
      .filter((e) => e.kind === 'character')
      .map((e) => ({ id: e.id, name: e.name, aliases: e.aliases }))
    const card = [scene.card.povId, ...(scene.card.presentIds ?? [])].filter((x): x is ID => !!x)
    const request = commandsRequest(text, castOf(text, everyone, { card, under: before }), before)
    if (store.readHash(db, sceneId) === request.hash) return 'unchanged'
    const result = await callModel({
      db,
      model,
      targetId: sceneId,
      job: 'memory',
      messages: request.messages,
      blocks: [{ id: 'commands', title: 'Under suggestion', priority: 1, text: request.messages[1].content, tokens: estimateTokens(request.messages[1].content), entryIds: [], dropped: false }],
      maxTokens: COMMANDS_REPLY,
      signal: o.signal ?? new AbortController().signal,
      closed: o.closed,
      background: true,
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl, retryDelays: [0, 0] } : {})
    })
    if (result.status === 'stopped') return 'stopped'
    if (result.status !== 'complete') return 'failed'
    const parsed = parseLenient(result.text)
    if (!parsed.ok) return 'failed'
    // The scene may have changed while it was read: keep the reading only for the words it was made from.
    if (o.closed() || repo.getScene(db, sceneId).text.trim() !== text) return 'stopped'
    keepReading(db, sceneId, story.id, readCommandsReply(parsed.value, request.ids, text), request.hash)
    return 'read'
  } catch (e) {
    console.warn('Could not read the scene for suggestions and commands', e)
    return 'failed'
  }
}
