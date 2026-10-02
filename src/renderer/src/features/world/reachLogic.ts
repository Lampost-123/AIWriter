// Pure helpers for edits that reach other stories (spec, Multi-story rules): an entry's profile is
// the same in every story, so editing it while working in a story other than the one where it
// first exists changes it everywhere. The page then says so, offering to keep the edit for that
// story on instead. Tested in reachLogic.test.ts.

import type { Entry, ID, Origin } from '@shared/types'
import type { ProfileBefore } from '@shared/contracts/entryViews'

/** The parts of a profile a start-of-story change can carry, as they were, with who each came from. */
export interface Profile {
  summary: string
  description: string
  fields: Record<string, string>
  /** Who each value came from ('summary', 'description' or a field's key); null when it simply follows the entry. */
  origins: Record<string, Origin | null>
}

export function profileOf(e: Pick<Entry, 'summary' | 'description' | 'fields' | 'fieldOrigins'>): Profile {
  const keys = ['summary', 'description', ...Object.keys(e.fields)]
  return {
    summary: e.summary,
    description: e.description,
    fields: { ...e.fields },
    origins: Object.fromEntries(keys.map((k) => [k, e.fieldOrigins?.[k] ?? null]))
  }
}

const same = (a: string | undefined, b: string | undefined): boolean => (a ?? '').trim() === (b ?? '').trim()

/** The keys ('summary', 'description' or a field's) whose value differs now from `before`. */
export function editedKeys(before: Profile, now: Pick<Entry, 'summary' | 'description' | 'fields'>): string[] {
  const out: string[] = []
  if (!same(before.summary, now.summary)) out.push('summary')
  if (!same(before.description, now.description)) out.push('description')
  for (const k of new Set([...Object.keys(before.fields), ...Object.keys(now.fields)])) {
    if (!same(before.fields[k], now.fields[k])) out.push(k)
  }
  return out
}

/**
 * The starting point again after a newer saved copy arrives while the page is open (the memory
 * keeper changed a field, a picture was added): values Adam hasn't edited take the newer copy's, so
 * someone else's change is never taken for his edit. `mine` is what the page held just before.
 */
export function rebase(
  since: Profile,
  mine: Pick<Entry, 'summary' | 'description' | 'fields'>,
  theirs: Parameters<typeof profileOf>[0]
): Profile {
  const edited = new Set(editedKeys(since, mine))
  const t = profileOf(theirs)
  const keep = (k: string): boolean => edited.has(k)
  const fields: Record<string, string> = {}
  const origins: Record<string, Origin | null> = {}
  for (const k of new Set([...Object.keys(since.fields), ...Object.keys(t.fields)])) {
    fields[k] = keep(k) ? (since.fields[k] ?? '') : (t.fields[k] ?? '')
  }
  for (const k of ['summary', 'description', ...Object.keys(fields)]) {
    origins[k] = keep(k) ? (since.origins[k] ?? null) : (t.origins[k] ?? null)
  }
  return {
    summary: keep('summary') ? since.summary : t.summary,
    description: keep('description') ? since.description : t.description,
    fields,
    origins
  }
}

/**
 * The starting point again once Adam dismisses the note (keeping his edits for every story): the
 * profile as it is now, each value he edited marked as his. `origins` are who each value came from
 * as last saved; his edits are marked here too, as the page may not have heard back from saving them.
 */
export function dismissProfile(
  since: Profile,
  now: Pick<Entry, 'summary' | 'description' | 'fields'>,
  origins: Entry['fieldOrigins'] | undefined
): Profile {
  const next = profileOf({ ...now, fieldOrigins: origins ?? {} })
  for (const k of editedKeys(since, now)) next.origins[k] = 'adam'
  return next
}

/** What "Only from <story> on" sends: the edited values as they were before, and who they came from. */
export function beforeOf(before: Profile, keys: string[]): ProfileBefore {
  const out: ProfileBefore = { origins: {} }
  for (const k of keys) {
    if (k === 'summary') out.summary = before.summary
    else if (k === 'description') out.description = before.description
    else out.fields = { ...out.fields, [k]: before.fields[k] ?? '' }
    out.origins[k] = before.origins[k] ?? null
  }
  return out
}

/**
 * The story an edit could be kept for instead: the story Adam is working in, when the entry doesn't
 * first exist in it (so the edit reaches stories it does exist in). Null when there's no such story,
 * or where the entry first exists isn't known yet.
 */
export function reachStory(
  homes: (ID | null)[] | null,
  storyId: ID | null,
  stories: { id: ID; title: string }[]
): { id: ID; title: string } | null {
  if (!homes || !homes.length || !storyId || homes.includes(storyId)) return null
  const story = stories.find((s) => s.id === storyId)
  return story ? { id: story.id, title: story.title.trim() || 'this story' } : null
}

/** "This changes Mara in every story". */
export const reachNote = (name: string): string => `This changes ${name.trim() || 'it'} in every story`

/** "Only from Book 2 on". */
export const reachButton = (title: string): string => `Only from ${title} on`
