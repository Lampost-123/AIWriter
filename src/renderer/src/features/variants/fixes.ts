// Where the fix is for a problem the variants had, read from its plain words (and its code, when it came
// with one): the length (in the draft options, which the Variants page shows as "Length of each"),
// Settings › Models (the key, the credit, the model), or both. The length comes first, as Generate's
// "Draft options" button does, since it is the quickest fix. Pure, so it is unit-tested.

/** A way to fix a problem: change the length, or open Settings › Models. */
export type Fix = 'length' | 'settings'

/** The fixes a problem's message names, the first to offer first; none when it names neither. */
export function fixesFor(message: string, code?: string | null): Fix[] {
  const fixes: Fix[] = []
  if (code === 'too-long' || /\bdraft options\b/.test(message)) fixes.push('length')
  if (code === 'no-writer-model' || code === 'no-key' || /\bSettings\b/.test(message)) fixes.push('settings')
  return fixes
}
