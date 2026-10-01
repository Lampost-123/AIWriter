// Lets the window ask the interface to save pending edits before it closes.
let pending: (() => void) | null = null

export function waitForFlush(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs)
    function done(): void {
      clearTimeout(timer)
      pending = null
      resolve()
    }
    pending = done
  })
}

export function resolveFlush(): void {
  pending?.()
}
