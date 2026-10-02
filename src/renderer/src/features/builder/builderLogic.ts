// The builder's steps, and the pure rules behind its screens: which fields each step holds, how far
// along a step is, what a save sends, and where an AI suggestion may go. No React and no API calls
// here, so they're easy to test (see builderLogic.test.ts).

import { CHARACTER_GROUPS, CHARACTER_ROLES, FIELD_GROUPS, type FieldDef } from '@shared/fields'
import type { Entry, EntryInput } from '@shared/types'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'

/** How a field is typed in: the big name box, a comma list, the role picker, one line or a few paragraphs. */
export type FieldType = 'name' | 'list' | 'role' | 'line' | 'text'

export interface StepField {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  hint?: string
}

export interface Step {
  id: string
  label: string
  /** One sentence under the step's title saying what it is for. */
  intro: string
  fields: StepField[]
  /** Relationships and Review are their own screens, not fields. */
  special?: 'relationships' | 'review'
}

export type StepStatus = 'empty' | 'partly' | 'complete'

const groupFields = (kind: BuilderKind, ...keys: string[]): StepField[] => {
  const defs = new Map<string, FieldDef>((FIELD_GROUPS[kind] ?? []).flatMap((g) => g.fields.map((f) => [f.key, f] as const)))
  return keys.map((key) => {
    const f = defs.get(key)
    if (!f) throw new Error(`No field ${key} for ${kind}`)
    return { key, label: f.label, type: key === 'role' ? 'role' : f.type, placeholder: f.placeholder }
  })
}

const charGroup = (id: string): string[] => CHARACTER_GROUPS.find((g) => g.id === id)?.fields.map((f) => f.key) ?? []

const NAME: Record<BuilderKind, StepField> = {
  character: { key: 'name', label: 'Name', type: 'name', placeholder: 'Their name' },
  place: { key: 'name', label: 'Name', type: 'name', placeholder: 'Its name' },
  group: { key: 'name', label: 'Name', type: 'name', placeholder: 'Its name' },
  item: { key: 'name', label: 'Name', type: 'name', placeholder: 'Its name' }
}

const listOf = (placeholder: string): StepField => ({
  key: 'aliases',
  label: 'Aliases',
  type: 'list',
  placeholder,
  hint: 'Separate with commas.'
})
const ALIASES: Record<BuilderKind, StepField> = {
  character: listOf("nicknames, titles, 'the old woman'"),
  place: listOf("other names, like 'the Old Keep'"),
  group: listOf("other names, like 'the Brotherhood'"),
  item: listOf("other names, like 'the old blade'")
}

const summaryOf = (placeholder: string): StepField => ({ key: 'summary', label: 'Short summary', type: 'line', placeholder })
const SUMMARY: Record<BuilderKind, StepField> = {
  character: summaryOf('A grumpy ex-soldier who runs the ferry and owes the Duke money'),
  place: summaryOf('A salt-crusted port where nobody asks questions'),
  group: summaryOf('A guild of smugglers who answer to no crown'),
  item: summaryOf('A cracked compass that always points to the person you miss')
}

const descriptionOf = (placeholder: string): StepField => ({ key: 'description', label: 'Description', type: 'text', placeholder })
const DESCRIPTION: Record<BuilderKind, StepField> = {
  character: descriptionOf('Who they are, in your own words.'),
  place: descriptionOf('What it is, and why it matters to the story.'),
  group: descriptionOf('Who they are, and how others see them.'),
  item: descriptionOf('What it looks like, and why it matters to the story.')
}

const step = (id: string, label: string, intro: string, fields: StepField[]): Step => ({ id, label, intro, fields })

const basics = (kind: BuilderKind, intro: string, ...extra: StepField[]): Step =>
  step('basics', 'Basics', intro, [NAME[kind], ALIASES[kind], ...extra, SUMMARY[kind], DESCRIPTION[kind]])

const review = (intro: string): Step => ({ id: 'review', label: 'Review', intro, fields: [], special: 'review' })

const ONLY_NAME = 'Only a name is needed; everything else can wait.'
const SAVED = 'Everything is saved as you go.'
const char = (id: string): StepField[] => groupFields('character', ...charGroup(id))

const STEPS: Record<BuilderKind, Step[]> = {
  character: [
    basics('character', `Who they are at a glance. ${ONLY_NAME}`, ...char('basics')),
    step('looks', 'Looks', 'What someone notices first, and what they would remember.', char('looks')),
    step('personality', 'Personality', 'How they think and act, and what sets them off.', char('personality')),
    step('backstory', 'Backstory and secrets', 'Where they come from, and what they keep to themselves.', char('backstory')),
    step('arc', 'Goals and arc', 'What they want, what they need, and where the story takes them.', char('arc')),
    step('voice', 'Voice', 'How they sound. Interviewing them is the quickest way to find their voice.', char('voice')),
    {
      ...step('relationships', 'Relationships', 'Who they know among your characters, and what they are to each other.', []),
      special: 'relationships'
    },
    review(`The whole character on one page. ${SAVED}`)
  ],
  place: [
    basics('place', `What it is and what it is called. ${ONLY_NAME}`),
    step('look', 'Look and feel', 'What it looks like, and what it feels like there.', groupFields('place', 'atmosphere', 'geography')),
    step('senses', 'Sights, sounds and smells', 'What someone standing there would notice.', groupFields('place', 'senses')),
    step('history', 'History', 'What happened here, and what people still say about it.', groupFields('place', 'history')),
    step('people', 'Who is there', 'Who rules it, who lives there, and who passes through.', groupFields('place', 'people')),
    review(`The whole place on one page. ${SAVED}`)
  ],
  group: [
    basics('group', `Who they are and what they are called. ${ONLY_NAME}`, ...groupFields('group', 'category')),
    step('goals', 'Goals and ranks', 'What they want, and who gives the orders.', groupFields('group', 'goals', 'ranks')),
    step(
      'ways',
      'Allies, customs and history',
      'Who they stand with, how they mark themselves out, and where they came from.',
      groupFields('group', 'rivals', 'customs', 'history')
    ),
    review(`The whole group on one page. ${SAVED}`)
  ],
  item: [
    basics('item', `What it is and what it is called. ${ONLY_NAME}`, ...groupFields('item', 'category')),
    step('powers', 'Powers and limits', 'What it can do, and what using it costs.', groupFields('item', 'powers', 'limits')),
    step('origin', 'Where it came from', 'Who made it, and how it got to where it is now.', groupFields('item', 'origin')),
    review(`The whole item on one page. ${SAVED}`)
  ]
}

export const stepsFor = (kind: BuilderKind): Step[] => STEPS[kind]

/** Every key a profile of this kind has, in the order the steps show them. */
export function profileKeys(kind: BuilderKind): string[] {
  return STEPS[kind].flatMap((s) => s.fields.map((f) => f.key))
}

/** The field's label, for sentences and accessible names ("Keep the suggestion for Hair"). */
export function labelOf(kind: BuilderKind, key: string): string {
  for (const s of STEPS[kind]) for (const f of s.fields) if (f.key === key) return f.label
  return key
}

export const ROLE_OPTIONS = CHARACTER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))

/** A field's words as the builder shows them outside its box: the role as its picker names it ("Supporting"). */
export function shownValue(key: string, value: string): string {
  if (key !== 'role') return value
  const v = value.trim()
  return ROLE_OPTIONS.find((o) => o.value === v.toLowerCase())?.label ?? v.charAt(0).toUpperCase() + v.slice(1)
}

const filled = (v: string | undefined): boolean => !!v?.trim()

/**
 * How far along a step is: empty, partly done or complete. Relationships count as complete once
 * there is one; Review goes by the whole profile.
 */
export function stepStatus(kind: BuilderKind, step: Step, values: BuilderValues, relationships: number): StepStatus {
  if (step.special === 'relationships') return relationships > 0 ? 'complete' : 'empty'
  const keys = step.special === 'review' ? profileKeys(kind) : step.fields.map((f) => f.key)
  const n = keys.filter((k) => filled(values[k])).length
  return n === 0 ? 'empty' : n === keys.length ? 'complete' : 'partly'
}

export const STATUS_WORDS: Record<StepStatus, string> = { empty: 'empty', partly: 'partly done', complete: 'complete' }

/** An entry's profile as the builder shows it: aliases as one line separated by commas. */
export function valuesOf(kind: BuilderKind, e: Entry): BuilderValues {
  const out: BuilderValues = {}
  for (const key of profileKeys(kind)) {
    const v = entryText(e, key)
    if (v) out[key] = v
  }
  return out
}

/** The text an entry holds for one of the builder's keys. */
export function entryText(e: Pick<Entry, 'name' | 'aliases' | 'summary' | 'description' | 'fields'>, key: string): string {
  if (key === 'name') return e.name
  if (key === 'aliases') return e.aliases.join(', ')
  if (key === 'summary') return e.summary
  if (key === 'description') return e.description
  return e.fields[key] ?? ''
}

/** Splits "Mara, the old woman ,, Captain" into its names, dropping repeats. */
export function splitAliases(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(',')) {
    const item = raw.trim()
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * What to save of the profile on screen: the keys that changed since `base` (the profile as last
 * saved), as the entry's own fields. A name cleared while typing a new one isn't saved, so the entry
 * keeps its last name rather than become "Unnamed". Null when nothing changed.
 */
export function patchFor(kind: BuilderKind, values: BuilderValues, base: BuilderValues): { input: EntryInput; sent: BuilderValues } | null {
  const input: EntryInput = {}
  const sent: BuilderValues = {}
  const fields: Record<string, string> = {}
  for (const key of profileKeys(kind)) {
    const v = values[key] ?? ''
    if (v === (base[key] ?? '')) continue
    if (key === 'name') {
      if (!v.trim()) continue
      input.name = v.trim()
    } else if (key === 'aliases') input.aliases = splitAliases(v)
    else if (key === 'summary') input.summary = v
    else if (key === 'description') input.description = v
    else fields[key] = v
    sent[key] = v
  }
  if (Object.keys(fields).length) input.fields = fields
  return Object.keys(sent).length ? { input, sent } : null
}

/** The fields of a profile that have something in them, for making the entry. */
export function nonEmpty(values: BuilderValues): BuilderValues {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => filled(v)))
}

/**
 * Which suggestions can still be shown: those for fields that are empty on screen. Adam's words are
 * never covered by a suggestion; if he types in the field first, his words win.
 */
export function openSuggestions(suggestions: BuilderValues, values: BuilderValues): BuilderValues {
  return Object.fromEntries(Object.entries(suggestions).filter(([k, v]) => filled(v) && !filled(values[k])))
}

/**
 * Suggestions as Flesh out sends them while it writes (every one so far, each time): those Adam has
 * kept or discarded since it began stay gone.
 */
export function mergeSuggestions(current: BuilderValues, incoming: BuilderValues, decided: ReadonlySet<string>): BuilderValues {
  const out = { ...current }
  for (const [key, v] of Object.entries(incoming)) if (!decided.has(key)) out[key] = v
  return out
}

/**
 * The fields of a profile that is still arriving, in the order they first came: those already shown
 * keep their places and new ones go at the end, so nothing Adam is reading moves down the page.
 */
export function arrivalOrder(order: readonly string[], values: BuilderValues): string[] {
  const out = [...order]
  const seen = new Set(order)
  for (const [key, v] of Object.entries(values)) {
    if (seen.has(key) || !filled(v)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** The keys of a step that Flesh out can fill: the empty ones without a suggestion waiting. */
export function fleshOutKeys(step: Step, values: BuilderValues, suggestions: BuilderValues): string[] {
  return step.fields.map((f) => f.key).filter((k) => !filled(values[k]) && !filled(suggestions[k]))
}

/**
 * Whether a field shows "Drafted by AI" (its words are the AI's, as kept or built) or "Changed by
 * you" (they were, until Adam changed them while the builder was open). `ai` holds, by key, the AI's
 * words for each field that had them, or '' once Adam has made the field his.
 */
export function markOf(key: string, value: string, ai: Readonly<Record<string, string>>): 'ai' | 'edited' | null {
  if (!(key in ai)) return null
  return filled(value) && ai[key] === value ? 'ai' : 'edited'
}

/**
 * The AI's words by key after a save: fields saved as drafted by AI hold their words, and fields
 * that were the AI's but are now Adam's hold ''.
 */
export function aiAfterSave(kind: BuilderKind, ai: Readonly<Record<string, string>>, saved: Entry): Record<string, string> {
  const out: Record<string, string> = { ...ai }
  for (const key of profileKeys(kind)) {
    const origin = saved.fieldOrigins?.[key] ?? saved.origin
    const text = entryText(saved, key)
    if (origin === 'ai' && text.trim()) out[key] = text
    else if (key in out) out[key] = ''
  }
  return out
}

/**
 * A reply from the interview as a row of the sample lines: on one line, in quotes unless it already
 * has its own (a line with "he said" in it), added under the lines already there.
 */
export function withSampleLine(current: string, reply: string): string {
  const line = reply.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  if (!line) return current
  const quoted = /["“”]/.test(line) ? line : `"${line}"`
  const before = current.replace(/\s+$/, '')
  return before ? `${before}\n${quoted}` : quoted
}

/** True when the sample lines already hold this reply, so it isn't added twice. */
export function hasSampleLine(current: string, reply: string): boolean {
  const line = reply.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  if (!line) return false
  return current.split('\n').some((row) => row.trim().replace(/^["“]|["”]$/g, '') === line.replace(/^["“]|["”]$/g, ''))
}

/** "Brann Holt", or "this character" when it has no name yet: for sentences. */
export function displayName(kind: BuilderKind, values: BuilderValues): string {
  return values.name?.trim() || `this ${kind}`
}
