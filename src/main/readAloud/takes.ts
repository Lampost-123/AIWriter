// Adapted from mcreader-v2, src/server/speech/speak.ts (its ClipTake rows and `takeKey`: "Redo this line"; reading
// aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader kept them in its database; AI Write keeps
// them beside the spoken audio, in the app's cache folder (never in a world).
//
// "Redo this line": the line is voiced again with another of Breeze's seeds, and that take is the one read from then
// on. Kept by the clip's key as it was first planned, so the same words in the same voice and delivery find it again.
import { readJson, writeFileAtomic } from '../util'

/** Lines redone that are remembered; the oldest go first past it. */
const KEEP = 5000
/** The most takes one line goes through (the speech server's limit too). */
export const MAX_TAKE = 99

export class TakeStore {
  private takes: Map<string, number> | null = null

  constructor(private readonly file: string) {}

  private load(): Map<string, number> {
    if (!this.takes) {
      const raw = readJson<Record<string, unknown>>(this.file, {})
      this.takes = new Map(
        Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(
          (e): e is [string, number] => Number.isInteger(e[1]) && (e[1] as number) > 0
        )
      )
    }
    return this.takes
  }

  /** Which take a line is read as: 0 for the first. */
  get(key: string): number {
    return this.load().get(key) ?? 0
  }

  /** One more take of a line, kept from now on. Returns its number. */
  next(key: string): number {
    const takes = this.load()
    const n = Math.min(MAX_TAKE, (takes.get(key) ?? 0) + 1)
    takes.delete(key)
    takes.set(key, n)
    while (takes.size > KEEP) takes.delete(takes.keys().next().value!)
    try {
      writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(takes)))
    } catch (e) {
      console.warn('[read aloud] could not keep a redone line', e)
    }
    return n
  }
}
