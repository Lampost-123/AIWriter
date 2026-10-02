// One Esc does one thing. Something that closes on Esc without being a pop-up layer (the "Selected
// words" bar, the floating binder) takes the press, so the writing page's own Esc (stopping a draft)
// leaves it alone: the draft carries on, and the next Esc stops it.

const taken = new WeakSet<Event>()

/** Marks this Esc as used up by what it just closed. */
export function takeEscape(e: Event): void {
  taken.add(e)
}

/** True when something already closed on this Esc. */
export const escapeTaken = (e: Event): boolean => taken.has(e)
