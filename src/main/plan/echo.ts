// The plan goes in as the opening of the writer's own notes, after the closing instruction (plan.ts). A writer may say
// those notes again before its prose; they are taken off the start of the draft as it streams (drafts.ts), so they
// never reach the page, the record or the word count. Pure.

/** What the plan's notes say first, the heads of their two parts, and their last line, leading into the prose. */
export const PLAN_HEAD = 'My notes before I write (I keep to them as I go):'
export const PLAN_PARTS = { keep: 'What the scene rests on, as things stand:', changes: 'What happens on the page, in order:' } as const
export const PLAN_GO = {
  start: 'Now the prose itself:',
  here: 'Now the prose, carrying straight on from the very end of the scene so far:'
} as const

/** True when a draft's messages carry a plan's notes. */
export const carriesPlan = (messages: readonly { content: unknown }[]): boolean =>
  messages.some((m) => typeof m.content === 'string' && m.content.includes(PLAN_HEAD))

const STARTERS: string[] = [PLAN_HEAD, PLAN_PARTS.keep, PLAN_PARTS.changes, PLAN_GO.start, PLAN_GO.here]
const isGo = (line: string): boolean => line.trim() === PLAN_GO.start || line.trim() === PLAN_GO.here
/** A line the notes are made of: one of their own lines, a "- " line, a numbered line, or a blank. */
const notesLine = (line: string): boolean => {
  const l = line.trim()
  return !l || STARTERS.includes(l) || /^- \S/.test(l) || /^\d+\. \S/.test(l)
}
/** Notes longer than this are not waited for: what is held goes out. */
const HOLD_MOST = 8_000

/**
 * Takes notes said again off the start of a draft as it streams. While the start could still be the notes, it is held
 * back; once it is plainly prose, everything goes through untouched. Notes lines are dropped up to the "Now the
 * prose" line (and the blank lines after it), or up to the first line that isn't a notes line.
 */
export class PlanEchoFilter {
  private held = ''
  private mode: 'start' | 'notes' | 'trim' | 'done'

  /** `on`: the draft's briefing carries a plan (carriesPlan); otherwise nothing is held or taken. */
  constructor(on: boolean) {
    this.mode = on ? 'start' : 'done'
  }

  push(text: string): string {
    if (this.mode === 'done') return text
    if (this.mode === 'trim') return this.trimmed(text)
    this.held += text
    return this.settle(false)
  }

  /** The reply has ended: whatever is held that isn't notes. */
  flush(): string {
    if (this.mode === 'done' || this.mode === 'trim') return ''
    return this.settle(true)
  }

  private settle(end: boolean): string {
    if (this.mode === 'start') {
      const lead = this.held.replace(/^\s+/, '')
      if (STARTERS.some((s) => lead.startsWith(s))) {
        this.mode = 'notes'
        this.held = lead
      } else if (!end && STARTERS.some((s) => s.startsWith(lead))) return ''
      else return this.release(this.held)
    }
    for (;;) {
      const nl = this.held.indexOf('\n')
      if (nl < 0) {
        if (!end && this.held.length < HOLD_MOST) return ''
        // The reply ended (a last notes line goes), or the notes run on too long to wait for (what is held goes out).
        return this.release(end && notesLine(this.held) ? '' : this.held)
      }
      const line = this.held.slice(0, nl)
      if (!notesLine(line)) return this.release(this.held)
      this.held = this.held.slice(nl + 1)
      if (isGo(line)) {
        const rest = this.held
        this.held = ''
        this.mode = 'trim'
        return this.trimmed(rest)
      }
    }
  }

  /** After the notes: the blank lines before the prose go. */
  private trimmed(text: string): string {
    const t = text.replace(/^\s+/, '')
    if (t) this.mode = 'done'
    return t
  }

  private release(text: string): string {
    this.mode = 'done'
    this.held = ''
    return text
  }
}
