// Reading aloud, from anywhere in the window: whether it is reading now, Listen (Ctrl+L) and Stop reading
// (Ctrl+Shift+Space). Owned by the Read aloud part. Groundwork stand-in.
import { create } from 'zustand'

export const useReading = create<{ reading: boolean; paused: boolean }>(() => ({ reading: false, paused: false }))

/** Listen from the cursor, or pause or resume. */
export function toggleListen(): void {}

/** Stops reading, from anywhere. */
export function stopReading(): void {}
