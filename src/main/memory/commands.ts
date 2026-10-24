// Under suggestion: what each command is and does as of a point in the story, from its steps (db/commands.ts). Pure.
// The rules (Adam, 2026-10-24):
//   - Commands stack. A new one never replaces another by itself: no socks and no bra both hold. One that keeps every
//     piece of clothing off ("be naked") covers the other clothing ones while it holds; when it ends they still hold.
//   - A command with a trigger is planted and waits: it changes nothing until a scene says the trigger happened ('fired').
//     Then its effect holds from that point on (or for that scene only), and a trigger meant for 'every' time waits again.
//   - An end ends it from that scene on; the scenes before keep it.
//   - A step the memory wasn't sure of counts only once Adam says yes; one he said no to never counts.
import type { ID } from '@shared/types'
import type {
  CommandKind,
  CommandStatus,
  CommandStep,
  CommandStepView,
  CommandValues,
  CommandView,
  PersonUnder,
  TriggerBy
} from '@shared/contracts/commands'
import type { CommandRow } from '../db/commands'

export const COMMAND_KINDS: CommandKind[] = ['clothing', 'feeling', 'action', 'forget', 'other']

export const EMPTY_VALUES: CommandValues = {
  words: '',
  does: '',
  kind: 'other',
  off: [],
  all: false,
  trigger: '',
  triggerBy: 'anyone',
  every: false,
  lasts: 'story',
  feels: ''
}

const text = (v: unknown, most = 300): string | undefined => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, most) : undefined)

/** A piece of clothing as one plain word or two, lower case ("Socks" and "her socks" are "socks"). */
export const pieceWord = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^(?:her|his|their|my|your|the|a|an|any)\s+/, '')
    .replace(/[^a-z' -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Only what can be kept of a command's details, from the memory model or the interface. */
export function cleanValues(v: unknown): Partial<CommandValues> {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const out: Partial<CommandValues> = {}
  const words = text(o.words)
  if (words !== undefined) out.words = words
  const does = text(o.does)
  if (does !== undefined) out.does = does
  if (typeof o.kind === 'string' && COMMAND_KINDS.includes(o.kind as CommandKind)) out.kind = o.kind as CommandKind
  if (Array.isArray(o.off)) out.off = [...new Set(o.off.filter((x): x is string => typeof x === 'string').map(pieceWord).filter(Boolean))].slice(0, 12)
  if (typeof o.all === 'boolean') out.all = o.all
  const trigger = text(o.trigger, 160)
  if (trigger !== undefined) out.trigger = trigger
  if (o.triggerBy === 'anyone' || o.triggerBy === 'giver') out.triggerBy = o.triggerBy as TriggerBy
  if (typeof o.every === 'boolean') out.every = o.every
  if (o.lasts === 'story' || o.lasts === 'scene') out.lasts = o.lasts
  const feels = text(o.feels)
  if (feels !== undefined) out.feels = feels
  return out
}

/** Whether a step counts towards what holds: not one Adam said no to, nor one the memory wasn't sure of until he says yes. */
export const stepCounts = (s: CommandStep): boolean => s.answer !== 'no' && (!s.unsure || s.answer === 'yes')

export interface CommandsInput {
  commands: CommandRow[]
  steps: CommandStep[]
  /** Every scene on the line in story order, later ones included (their steps show greyed in a history). */
  order: ID[]
  /** The point: the index in `order` of the scene asked about; order.length - 1 for the end of the story so far. */
  point: number
  /** As that scene begins (its own steps not yet), rather than as it ends. */
  asItBegins?: boolean
  where: (sceneId: ID) => string
  nameOf: (entryId: ID) => string | null
}

interface Placed {
  step: CommandStep
  index: number
}

function sortSteps(steps: CommandStep[], indexOf: Map<ID, number>): Placed[] {
  return steps
    .flatMap((step) => {
      const index = indexOf.get(step.sceneId)
      return index === undefined ? [] : [{ step, index }]
    })
    .sort((a, b) => a.index - b.index || a.step.seq - b.step.seq || a.step.createdAt.localeCompare(b.step.createdAt))
}

/** One command as of the point, or null when it wasn't given by then (or its giving doesn't count). */
function commandAt(c: CommandRow, placed: Placed[], input: CommandsInput): CommandView | null {
  const last = input.asItBegins ? input.point - 1 : input.point
  const counted = placed.filter((p) => p.index <= last && stepCounts(p.step))
  const givenAt = counted.findIndex((p) => p.step.kind === 'given')
  if (givenAt < 0) return null
  let values: CommandValues = { ...EMPTY_VALUES }
  let inEffect = false
  let waiting = false
  let ended = false
  let fired = 0
  /** The scene its effect is held to, for an effect that lasts one scene. */
  let heldTo: number | null = null
  for (const { step, index } of counted.slice(givenAt)) {
    const patch = cleanValues(step.values)
    switch (step.kind) {
      case 'given':
        if (ended || inEffect || waiting) break
        values = { ...EMPTY_VALUES, ...patch }
        waiting = !!values.trigger
        inEffect = !values.trigger
        heldTo = inEffect && values.lasts === 'scene' ? index : null
        break
      case 'stronger':
      case 'changed': {
        if (ended) break
        const hadTrigger = !!values.trigger
        values = { ...values, ...patch }
        if (patch.trigger !== undefined && !!values.trigger !== hadTrigger) {
          // A trigger added waits (and nothing holds until it fires); one taken away makes it hold now.
          waiting = !!values.trigger
          inEffect = !values.trigger
          heldTo = null
        }
        if (patch.every !== undefined && values.trigger && fired > 0) waiting = values.every
        if (patch.lasts !== undefined && inEffect) heldTo = values.lasts === 'scene' ? index : null
        break
      }
      case 'fired':
        if (ended) break
        fired++
        inEffect = true
        heldTo = values.lasts === 'scene' ? index : null
        waiting = !!values.trigger && values.every
        break
      case 'resisted':
        break
      case 'ended':
        ended = true
        inEffect = false
        waiting = false
        heldTo = null
        break
    }
  }
  // An effect for one scene only holds in that scene, as it ends.
  if (inEffect && heldTo !== null && (input.asItBegins || heldTo !== input.point)) inEffect = false
  const status: CommandStatus = ended ? 'ended' : inEffect ? 'in-effect' : waiting ? 'waiting' : 'ended'
  const steps: CommandStepView[] = placed
    .filter((p) => p.step.answer !== 'no')
    .map((p) => ({ ...p.step, where: input.where(p.step.sceneId), later: p.index > last }))
  const given = counted[givenAt].step
  return {
    id: c.id,
    subjectId: c.subjectId,
    subjectName: input.nameOf(c.subjectId) ?? 'Someone',
    giverId: c.giverId,
    giverName: c.giverId ? input.nameOf(c.giverId) : null,
    values,
    status,
    inEffect,
    waiting,
    fired,
    givenSceneId: given.sceneId,
    givenWhere: input.where(given.sceneId),
    steps,
    unsure: placed.filter((p) => p.step.unsure && p.step.answer === '').length,
    coveredBy: null
  }
}

/** What someone wears by command, in plain words: "nothing", "no socks, no bra", or '' when no clothing command holds. */
export function wearingByCommand(commands: CommandView[]): string {
  const holding = commands.filter((c) => c.inEffect && c.values.kind === 'clothing')
  if (holding.some((c) => c.values.all)) return 'nothing'
  const off = [...new Set(holding.flatMap((c) => c.values.off))]
  return off.map((p) => `no ${p}`).join(', ')
}

/**
 * Every person under a command as of the point, each with their commands (holding first, then waiting, then over) and
 * what they wear by command. Commands not given by then are left out. People who are gone from the world are left out.
 */
export function commandsAt(input: CommandsInput): PersonUnder[] {
  const indexOf = new Map(input.order.map((id, i) => [id, i]))
  const bySubject = new Map<ID, CommandView[]>()
  for (const c of input.commands) {
    if (input.nameOf(c.subjectId) === null) continue
    const view = commandAt(
      c,
      sortSteps(
        input.steps.filter((s) => s.commandId === c.id),
        indexOf
      ),
      input
    )
    if (!view) continue
    bySubject.set(c.subjectId, [...(bySubject.get(c.subjectId) ?? []), view])
  }
  const rank: Record<CommandStatus, number> = { 'in-effect': 0, waiting: 1, ended: 2 }
  const people: PersonUnder[] = []
  for (const [entryId, commands] of bySubject) {
    // The latest "everything off" holding covers the other clothing commands holding (they still hold underneath).
    const cover = commands
      .filter((c) => c.inEffect && c.values.kind === 'clothing' && c.values.all)
      .sort((a, b) => (indexOf.get(b.givenSceneId) ?? 0) - (indexOf.get(a.givenSceneId) ?? 0))[0]
    if (cover) for (const c of commands) if (c !== cover && c.inEffect && c.values.kind === 'clothing') c.coveredBy = cover.id
    commands.sort((a, b) => rank[a.status] - rank[b.status] || (indexOf.get(a.givenSceneId) ?? 0) - (indexOf.get(b.givenSceneId) ?? 0))
    people.push({ entryId, name: commands[0].subjectName, commands, wearing: wearingByCommand(commands) })
  }
  return people.sort((a, b) => a.name.localeCompare(b.name))
}
