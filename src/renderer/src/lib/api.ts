import type { AppApi, ApiMethod, AppEventName, AppEvents } from '@shared/api'

/** An error from the main process. `message` is already in plain words for Adam. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

/** Typed client for the main-process API: `await api.getScene(id)`. */
export const api = new Proxy({} as AppApi, {
  get: (_t, method: string) => async (...args: unknown[]) => {
    const res = await window.aiwrite.invoke(method as ApiMethod, ...args)
    if (!res.ok) throw new ApiError(res.error.message, res.error.code)
    return res.value
  }
})

/** Subscribes to a main-process event. Returns an unsubscribe function. */
export function onEvent<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void {
  return window.aiwrite.on(event, listener)
}

export const isMac = (): boolean => window.aiwrite.platform === 'darwin'
/** "Ctrl" on Windows, "⌘" on Mac, for shortcut hints. */
export const modKey = (): string => (isMac() ? '⌘' : 'Ctrl')
