// When "Update the memory" is offered for an issue (milestone 5, AI checks). Pure, no Electron imports.
// Only for a short value of a one-line field ("Eyes": "green"): never a summary, a description, sample
// lines or a field that holds a list, which a few words from the text would wipe out.

import type { EntryKind } from '@shared/types'
import { FIELD_GROUPS } from '@shared/fields'

/** The longest value "Update the memory" sets. */
export const MEMORY_FIX_MOST = 60

/** True when the text's value can take the place of this field's. */
export function memoryFixable(kind: EntryKind | string, field: string | null | undefined, value: string | null | undefined): boolean {
  if (!field || !value) return false
  const def = (FIELD_GROUPS[kind as EntryKind] ?? []).flatMap((g) => g.fields).find((f) => f.key === field)
  if (!def || def.type !== 'line') return false
  const v = value.trim()
  return !!v && v.length <= MEMORY_FIX_MOST && !/[\n;]/.test(v)
}
