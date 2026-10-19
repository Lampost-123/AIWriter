// Instruction packs (overhaul phase 2): each job's detailed instructions live in a short named pack (packs.ts) that an
// agent loads only when it does that job, the way Anthropic's "skills" work, instead of every rule riding in every
// prompt. An agent is offered:
//   - the list (packList): each pack's name and one line, in its system prompt, which stays the same from request to
//     request (and question to question), so a provider's prompt cache keeps it;
//   - the tool (loadInstructionsTool): load_instructions(name), answered here with the pack's text (and anything the agent
//     adds for its own tools, `extra`) as the tool's result, which comes after everything cached.
// An agent may offer only some packs (`offered`). A pack loaded once in an answer is not sent again. No Electron imports.

import type { ToolSpec } from '@shared/types'
import { PACKS, type InstructionPack } from './packs'

export { PACKS, type InstructionPack } from './packs'

/** The tool's name. */
export const LOAD_INSTRUCTIONS = 'load_instructions'

/** Every pack's name. */
export const PACK_NAMES: readonly string[] = PACKS.map((p) => p.name)

/** A pack by its name (as the model wrote it: case, spaces and underscores don't matter), or null. */
export function packOf(name: unknown): InstructionPack | null {
  const want = typeof name === 'string' ? name.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/^["“']|["”']$/g, '') : ''
  return PACKS.find((p) => p.name === want) ?? null
}

/** The packs offered, in the registry's order (all of them when `names` is left out); unknown names are skipped. */
export const packsOffered = (names?: readonly string[]): InstructionPack[] =>
  names ? PACKS.filter((p) => names.includes(p.name)) : [...PACKS]

/**
 * The list every request carries, in the system prompt: what the packs are for and how to load one, then a line each.
 * Empty when none is offered.
 */
export function packList(names?: readonly string[]): string {
  const offered = packsOffered(names)
  if (!offered.length) return ''
  return [
    'Instruction packs',
    `Before one of these jobs, load its pack with ${LOAD_INSTRUCTIONS} (with any look-ups, in the same step) and follow it:`,
    ...offered.map((p) => `- ${p.name}: ${p.description}`)
  ].join('\n')
}

/** load_instructions, offering these packs by name. */
export function loadInstructionsTool(names?: readonly string[]): ToolSpec {
  const offered = packsOffered(names).map((p) => p.name)
  return {
    name: LOAD_INSTRUCTIONS,
    description: 'Load the full instructions for a job, by the pack’s name as your instructions list it. Its text comes back; follow it for that job.',
    parameters: { type: 'object', properties: { name: { type: 'string', enum: offered } }, required: ['name'] }
  }
}

/** A load_instructions call answered. */
export interface PackAnswer {
  /** The pack loaded, or null. */
  pack: InstructionPack | null
  /** For the call's row: "Reading the instructions for planning a scene". */
  label: string
  /** What the model is told. */
  text: string
  ok: boolean
}

/**
 * Answers load_instructions. Never throws: an unknown pack, or one not offered, says which there are. `loaded`: the packs
 * already sent in this answer (a pack is sent once; the set is updated). `extra`: what this agent adds to a pack for its
 * own tools (the editor chat's fields for its changes), put after the pack's text.
 */
export function loadInstructions(
  args: string | Record<string, unknown>,
  o: { offered?: readonly string[]; loaded?: Set<string>; extra?: (name: string) => string } = {}
): PackAnswer {
  let a: Record<string, unknown> = {}
  if (typeof args === 'string') {
    try {
      const v = args.trim() ? (JSON.parse(args) as unknown) : {}
      if (v && typeof v === 'object' && !Array.isArray(v)) a = v as Record<string, unknown>
    } catch {
      // below: no name
    }
  } else a = args
  const offered = packsOffered(o.offered)
  const names = offered.map((p) => p.name).join(', ')
  const pack = packOf(a.name ?? a.pack)
  if (!pack || !offered.includes(pack)) {
    const asked =
      typeof a.name === 'string' && a.name.trim() ? `There is no pack called “${a.name.trim().slice(0, 60)}”.` : 'Say which pack: `name`.'
    return { pack: null, label: 'Looking for instructions', text: `${asked} The packs are: ${names}.`, ok: false }
  }
  const label = `Reading the instructions for ${pack.title}`
  if (o.loaded?.has(pack.name)) return { pack, label, text: `The ${pack.name} pack is already loaded above: follow it.`, ok: true }
  o.loaded?.add(pack.name)
  const more = o.extra?.(pack.name).trim() ?? ''
  return { pack, label, text: more ? `${pack.text}\n\n${more}` : pack.text, ok: true }
}
