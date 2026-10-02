// Whether AI Write is starting the speech server right now, so a request made meanwhile (reading aloud
// pressed as the app opens) waits for it instead of failing. Set by src/main/speech/index.ts, read by
// speechFetch (client.ts). No Electron here.

let pending: Promise<unknown> | null = null

/** index.ts: the start under way, or null once it has finished. */
export function setStarting(start: Promise<unknown> | null): void {
  pending = start
}

/** Resolves when the start under way has finished, whether it worked or not (at once when there is none). */
export function whenStarted(): Promise<void> {
  return pending
    ? pending.then(
        () => undefined,
        () => undefined
      )
    : Promise.resolve()
}

export const isStarting = (): boolean => pending !== null
