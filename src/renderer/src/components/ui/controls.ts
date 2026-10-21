// The controls' shared look (Button, IconButton, Input, Textarea, Select, Checkbox, Slider): one greyed-out look,
// one rounding for each height, and one focus ring, so a control looks the same wherever it is used.

/** Greyed out: half strength, and nothing under the pointer reacts. */
export const DISABLED = 'disabled:pointer-events-none disabled:opacity-50'

/**
 * The focus ring: 2px of the accent, 2px out from the control, when the keyboard brought focus there (text boxes
 * show it whenever they are focused, as Chromium counts them as keyboard-focused). The same as the app-wide
 * `:focus-visible` rule in styles.css; said here so a control that draws its own outline can't lose it.
 */
export const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus)'

/** One rounding for each control height: small (24 to 28px), medium (32px), large (40px). */
export const RADIUS = { sm: 'rounded-[8px]', md: 'rounded-[9px]', lg: 'rounded-[11px]' } as const
