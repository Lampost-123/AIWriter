// The narrator at one even pace (Adam, 2026-10-03: "the narrator is still speeding up and slowing down a lot"). The
// speech model reads each clip at its own speed, and a mood ("tense", "hushed") hurries or drags it. So the player
// measures how fast each narration clip speaks (words a second, at 1×) and plays it a little faster or slower, toward
// the narrator's usual pace: the middle of the last clips it read. The pitch is kept (the player's own speed).

/** Clips shorter than this say too little to measure. */
const MIN_WORDS = 6
/** How many recent clips make the narrator's usual pace. */
const KEEP = 24
/** The most a clip is sped up or slowed down: beyond this, the change itself would be heard. */
export const MOST_FASTER = 1.3
export const MOST_SLOWER = 0.8

/** The words a clip speaks: sound tags like "(sigh)" and "[pause]" aren't words. */
export function spokenWords(text: string): number {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]|\*/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** One narrator voice's usual pace, learnt as it reads. */
export class PaceKeeper {
  private rates: number[] = []

  /** How much faster (above 1) or slower (below 1) to play this clip, so it goes at the usual pace. */
  factor(words: number, seconds: number): number {
    if (words < MIN_WORDS || !(seconds > 0) || !Number.isFinite(seconds)) return 1
    const rate = words / seconds
    const usual = this.rates.length >= 2 ? median(this.rates) : rate
    this.rates.push(rate)
    if (this.rates.length > KEEP) this.rates.shift()
    return Math.min(MOST_FASTER, Math.max(MOST_SLOWER, usual / rate))
  }
}

const keepers = new Map<string, PaceKeeper>()

/** The pace keeper for a narrator voice (its voice and description), kept for the session. */
export function paceKeeper(voice: string): PaceKeeper {
  let k = keepers.get(voice)
  if (!k) keepers.set(voice, (k = new PaceKeeper()))
  return k
}
