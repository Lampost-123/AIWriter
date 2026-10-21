// Numbers typed into Settings' boxes. Pure, so it is unit-tested (typed.test.ts).

/** A typed temperature ("1,5" too), or null while it isn't a number yet. */
export function parseTemperature(typed: string): number | null {
  const t = typed.trim().replace(',', '.')
  if (t === '' || t === '.' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
