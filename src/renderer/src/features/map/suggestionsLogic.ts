// Under suggestion's words (the Map room): what each status and step is called, and the scenes to pick from. Pure.
import type { CommandStatus, CommandStepKind, CommandStepView, CommandValues, CommandView, CommandLasts, CommandKind } from '@shared/contracts/commands'
import type { ID, Outline } from '@shared/types'

export const STATUS_WORDS: Record<CommandStatus, string> = {
  'in-effect': 'In effect',
  waiting: 'Waiting for its trigger',
  ended: 'Over'
}

/** What a step is called in a command's history. Adam's own say so. */
export function stepWords(s: Pick<CommandStepView, 'kind' | 'origin'>): string {
  const words: Record<CommandStepKind, string> = {
    given: 'Given',
    stronger: 'Made stronger',
    changed: 'Changed',
    fired: 'Set off',
    resisted: 'Resisted',
    ended: 'Ended'
  }
  const w = words[s.kind]
  return s.origin === 'adam' ? `${w} by you` : w
}

/** What a step says beside its name: the scene's own words, Adam's note, or what changed. */
export function stepText(s: Pick<CommandStepView, 'quote' | 'note' | 'values'>): string {
  if (s.quote) return `“${s.quote}”`
  if (s.note) return s.note
  const v = s.values
  const bits = [v.does, v.trigger !== undefined ? (v.trigger ? `trigger: ${v.trigger}` : 'no trigger now') : '', v.feels ? `feels ${v.feels}` : '']
  return bits.filter(Boolean).join(' · ')
}

export const KIND_OPTIONS: { value: CommandKind; label: string }[] = [
  { value: 'clothing', label: 'Clothing' },
  { value: 'feeling', label: 'Feeling' },
  { value: 'action', label: 'Something to do' },
  { value: 'forget', label: 'Forgetting' },
  { value: 'other', label: 'Other' }
]

export const LASTS_OPTIONS: { value: CommandLasts; label: string }[] = [
  { value: 'story', label: 'Until the story ends it' },
  { value: 'scene', label: 'That scene only' }
]

/** How long it lasts, in words. */
export function lastsWords(v: Pick<CommandValues, 'lasts' | 'trigger' | 'every'>): string {
  if (v.trigger) {
    const each = v.every ? 'Works every time' : 'Works once'
    return v.lasts === 'scene' ? `${each}; each time, for that scene` : `${each}; then holds until the story ends it`
  }
  return v.lasts === 'scene' ? 'For that scene only' : 'Until the story ends it'
}

/** The pieces typed as "socks, bra" as a list. */
export const piecesOf = (s: string): string[] =>
  s
    .split(/[,;]|\band\b/)
    .map((x) => x.trim())
    .filter(Boolean)

export interface SceneOption {
  value: ID
  label: string
  /** The scene has words. */
  written: boolean
}

/** Every scene of the story in order, "Ch 2, Sc 3 · Title". */
export function sceneOptions(outline: Outline | null): SceneOption[] {
  if (!outline) return []
  const out: SceneOption[] = []
  outline.chapters.forEach((ch, ci) => {
    outline.scenes
      .filter((s) => s.chapterId === ch.id)
      .sort((a, b) => a.position - b.position)
      .forEach((s, si) => {
        const where = `Ch ${ci + 1}, Sc ${si + 1}`
        out.push({ value: s.id, label: s.title.trim() ? `${where} · ${s.title.trim()}` : where, written: s.wordCount > 0 })
      })
  })
  return out
}

/** The scene a change starts from by default: the scene the page is as of, else the last scene with words. */
export function defaultScene(options: SceneOption[], asOf: ID | null): ID | null {
  if (asOf && options.some((o) => o.value === asOf)) return asOf
  return [...options].reverse().find((o) => o.written)?.value ?? options[options.length - 1]?.value ?? null
}

/** How a person's row sums up their commands: "2 in effect · 1 waiting". */
export function personSummary(commands: CommandView[]): string {
  const on = commands.filter((c) => c.inEffect).length
  const waiting = commands.filter((c) => c.waiting && !c.inEffect).length
  const parts = [on ? `${on} in effect` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean)
  return parts.join(' · ') || 'Nothing holds now'
}
