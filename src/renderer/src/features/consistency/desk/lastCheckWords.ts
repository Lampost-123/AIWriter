// The words for when a story was last checked (lastCheck.ts). Pure, so it is unit-tested.

export interface LastCheck {
  at: number
  /** The scenes it read (empty scenes are skipped). */
  scenes: number
}

/** "Checked just now · 4 scenes", "Checked 5 minutes ago · 1 scene", "Checked at 14:05 · 12 scenes". */
export function lastCheckWords(last: LastCheck, now = Date.now()): string {
  const mins = Math.floor(Math.max(0, now - last.at) / 60_000)
  const when =
    mins < 1
      ? 'just now'
      : mins < 60
        ? `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
        : `at ${new Date(last.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return last.scenes ? `Checked ${when} · ${last.scenes} ${last.scenes === 1 ? 'scene' : 'scenes'}` : `Checked ${when}`
}
