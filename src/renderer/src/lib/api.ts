import type { AppApi, ApiMethod, AppEventName, AppEvents } from '@shared/api'
import { SPEND_LIMIT } from '@shared/contracts/usage'

/** An error from the main process. `message` is already in plain words for Adam. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

/**
 * Milestone 6 (Usage and cost): asks Adam whether to carry on when an AI action is refused because this month's
 * spending has reached his limit (set by features/usage/SpendWatch.tsx). True: carry on, and the same call is
 * made once more. False ("Not now"): the call fails with the code 'cancelled', as a stopped start does.
 */
let askAtLimit: ((message: string) => Promise<boolean>) | null = null
export const setAskAtLimit = (fn: ((message: string) => Promise<boolean>) | null): void => {
  askAtLimit = fn
}

async function call(method: string, args: unknown[], asked = false): Promise<unknown> {
  const res = await window.aiwrite.invoke(method as ApiMethod, ...args)
  if (res.ok) return res.value
  if (res.error.code === SPEND_LIMIT && askAtLimit && !asked) {
    if (await askAtLimit(res.error.message)) return call(method, args, true)
    throw new ApiError(`${res.error.message} Nothing was started.`, 'cancelled')
  }
  throw new ApiError(res.error.message, res.error.code)
}

/** Typed client for the main-process API: `await api.getScene(id)`. */
export const api = new Proxy({} as AppApi, {
  get: (_t, method: string) => async (...args: unknown[]) => call(method, args)
})

/** Subscribes to a main-process event. Returns an unsubscribe function. */
export function onEvent<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void {
  return window.aiwrite.on(event, listener)
}

export const isMac = (): boolean => window.aiwrite.platform === 'darwin'
/** "Ctrl" on Windows, "⌘" on Mac, for shortcut hints. */
export const modKey = (): string => (isMac() ? '⌘' : 'Ctrl')
