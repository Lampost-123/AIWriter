// Which of the scene card's beats are on the page already, found by the app with no model call (Adam, 2026-10-08:
// "They talk about what comes next" was written at steps 1, 6 and 11 of an Add below run, since nothing marked a beat
// done). Used by the writer's briefing for Add below (src/main/ai/context.ts, through ai/repetition.ts) and by the desk's
// next-beat chip and scene card (the window). Pure.

const STOP = new Set(
  (
    'a an the and or but if so as at by for from in into of off on onto out over to up with without about after before ' +
    'he she it they them him her his hers its their theirs i me my we us our you your this that these those there here ' +
    'was were is are be been being had has have do did does not no nor then than too very just only all any some ' +
    'what which who whom when where why how one two'
  ).split(' ')
)

const norm = (s: string): string => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
const wordsOf = (s: string): string[] => norm(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? []
const stem = (w: string): string => (w.length > 4 ? w.slice(0, 4) : w)

/**
 * How many of the scene card's beats, from the first, are on the page already. A beat is on the page when most of its
 * own words (not little ones; matched by their first four letters) are in the scene so far, at least two of them (both,
 * for a beat of two); beats come in order, so every beat before the last one found is done.
 */
export function beatsOnPage(beats: readonly string[], soFar: string | null | undefined): number {
  const page = new Set(wordsOf(soFar ?? '').map(stem))
  if (!page.size) return 0
  let done = 0
  beats.forEach((b, i) => {
    const own = [...new Set(wordsOf(b).filter((w) => !STOP.has(w) && w.length >= 3).map(stem))]
    if (own.length < 2) return
    const hit = own.filter((w) => page.has(w)).length
    const need = own.length <= 2 ? own.length : Math.ceil(own.length * 0.6)
    if (hit >= need) done = i + 1
  })
  return done
}

/** The card's beats with words, trimmed (empty lines left out), as the chip and the card show them. */
export const cardBeatsOf = (beats: readonly string[]): string[] => beats.map((b) => b.trim()).filter(Boolean)

/** Where the scene stands against its beats, for the desk's next-beat chip. */
export type BeatStand =
  | { kind: 'none' }
  | { kind: 'next'; index: number; beat: string; of: number }
  | { kind: 'all'; of: number }
  | { kind: 'done' }

/** The next beat to write, or all of them written (Mark done is offered), or the scene marked done. Nothing (hidden) when the card has no beats. */
export function beatStand(beats: readonly string[], done: number, sceneDone: boolean): BeatStand {
  const list = cardBeatsOf(beats)
  if (!list.length) return { kind: 'none' }
  if (sceneDone) return { kind: 'done' }
  if (done >= list.length) return { kind: 'all', of: list.length }
  return { kind: 'next', index: done, beat: list[done], of: list.length }
}
