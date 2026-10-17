// Small text helpers both sides share. Pure.

/** Anything as one tidy line: spaces and line breaks run together, ends trimmed, cut to `max` characters when given. */
export function oneLine(s: unknown, max?: number): string {
  const line = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return max === undefined ? line : line.slice(0, max).trim()
}
