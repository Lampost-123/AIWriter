// Which clips' audio to get, and in what order, while reading aloud: the clip about to play first, then the
// next three, so the voice never waits between lines. Pure, so it is unit-tested.

/** How many clips after the one playing are prepared ahead. */
export const AHEAD = 3

/**
 * The keys to get now, most urgent first: the clip at `index` (playing, or about to), then the `ahead` after it.
 * Clips already got (or on their way) are left out, and so are clips waiting for the AI's marks, whose words or
 * voice may still change. A clip that comes twice is got once.
 */
export function toFetch(
  clips: readonly { key: string; waits: boolean }[],
  index: number,
  have: (key: string) => boolean,
  ahead = AHEAD
): string[] {
  const out: string[] = []
  for (let i = Math.max(0, index); i < clips.length && i <= index + ahead; i++) {
    const c = clips[i]
    if (c.waits || have(c.key) || out.includes(c.key)) continue
    out.push(c.key)
  }
  return out
}
