// Adapted from Poor-Mans-Holodeck's src/lib/dictate.ts (trimMic, and the samples it keeps counted from the
// microphone opening): what the microphone has heard lately, held in memory while dictation is on, so a
// recording can start a little before it was asked for (the words said as the key goes down). Never
// written anywhere. Pure.

/** What is held while nothing is being recorded: enough for the moment before a key goes down. */
export const KEEP_SECONDS = 1
/** How far before the key went down a recording starts, so the words said as it goes down are kept. */
export const PRE_ROLL_SECONDS = 0.45

/** The microphone's sound held in memory, in the batches it arrived in, counted from when it opened. */
export interface Heard {
  chunks: Float32Array[]
  /** The sample `chunks[0]` starts at. */
  origin: number
  /** Samples received since opening. */
  total: number
}

/** Adds a batch that has just arrived. */
export function hear(h: Heard, batch: Float32Array): void {
  h.chunks.push(batch)
  h.total += batch.length
}

/** Lets go of what nobody needs: all but the last `keep` samples, and nothing a recording from `starts` still needs. */
export function trimHeard(h: Heard, keep: number, starts: Iterable<number>): void {
  let from = h.total - keep
  for (const s of starts) from = Math.min(from, s)
  while (h.chunks.length && h.origin + h.chunks[0].length <= from) {
    h.origin += h.chunks[0].length
    h.chunks.shift()
  }
}

/** Where a recording starts that goes `back` samples before now: as far back as is held. */
export const startBack = (h: Heard, back: number): number => Math.max(h.origin, h.total - Math.max(0, Math.floor(back)))
