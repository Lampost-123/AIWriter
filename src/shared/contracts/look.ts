// Milestone 6: themes finished (accent colour, reduced motion) and focus mode (F11).
// Owned by the Look and focus part (see docs/ARCHITECTURE.md, "Milestone 6"). Only this part changes this file.
//
// The accent colour is the setting `accent` (Settings › Appearance): one of ACCENT_IDS, or null for the
// theme's own colour. Each accent has its colours for Light, Dark and Sepia in styles.css
// (`[data-theme='…'][data-accent='…']`, the same values as features/look/accents.ts), switched on by
// <html data-accent>. The window opens with it already set (--aiwrite-accent=…, as the theme), so nothing flashes.
//
// Focus mode (F11) is the window's own business (features/look/focusMode.ts); the main process only makes the
// window fill the screen and back, and says when it stops filling it some other way.

/** The accent colours Adam can pick, besides the theme's own (null). */
export const ACCENT_IDS = ['teal', 'indigo', 'plum', 'graphite'] as const
export type AccentId = (typeof ACCENT_IDS)[number]

/** The accent as kept in Settings, when it is one there is; null (the theme's own) for anything else. */
export const accentIdOf = (value: unknown): AccentId | null =>
  typeof value === 'string' && (ACCENT_IDS as readonly string[]).includes(value) ? (value as AccentId) : null

/**
 * The looks. Classic (the app as it was before the New look, "Lamplight") was retired on 19 October 2026 (Adam: "retire
 * classic gui and no longer update it from now on"): the New look is the only look. It is still kept in Settings as
 * `look` and painted as <html data-look> (always 'new'). 'classic' stays a name here because settings may still keep
 * it: src/main/settings.ts moves it to the New look (and shows the one-time note), and AIWRITE_LOOK=classic in a test
 * still counts as a look. See docs/ARCHITECTURE.md, "The New look (Classic retired)".
 */
export const LOOKS = ['new', 'classic'] as const
export type Look = (typeof LOOKS)[number]

/** The look to paint: the New look, whatever is kept (a kept 'classic' is moved to it, src/main/settings.ts). */
export const lookOf = (_value: unknown): Look => 'new'

/**
 * Whether the one-time note about the New look is due when settings are read: only for someone who used AI Write
 * before the New look (their settings.json exists but has never had a look in it). A fresh install starts in the
 * New look with nothing to compare it with, so no note.
 */
export const lookNoteDue = (stored: Record<string, unknown> | null): boolean => stored !== null && !('look' in stored)

/**
 * Whether the one-time note saying Classic has been retired is due when settings are read: only for someone whose
 * settings still keep Classic. They are moved to the New look with every other setting kept (src/main/settings.ts).
 */
export const classicNoteDue = (stored: Record<string, unknown> | null): boolean => stored !== null && stored.look === 'classic'

/**
 * The New look's two layouts (Settings › Appearance › Layout): the desk (the page centred on a lit desk, the story's
 * spine on the left, rooms in the top bar) and the panels (the area rail, the side list and the scene panel). Kept in
 * Settings as `arrangement` (the name `layout` holds the panes' sizes), painted as <html data-arrangement>. See
 * docs/ARCHITECTURE.md, "The New look (Classic retired)".
 */
export const ARRANGEMENTS = ['desk', 'panels'] as const
export type Arrangement = (typeof ARRANGEMENTS)[number]

/** The layout as kept in Settings: the panels only when it says so, the desk for anything else. */
export const arrangementOf = (value: unknown): Arrangement => (value === 'panels' ? 'panels' : 'desk')

/**
 * Whether the one-time note about the desk is due when settings are read: only for someone who already used the New
 * look (their settings.json has a look, and it is the New look) and has never had a layout. Someone from before the New
 * look gets the New look's own note instead, someone moved from Classic the note about Classic; a fresh install has
 * nothing to compare it with.
 */
export const arrangementNoteDue = (stored: Record<string, unknown> | null): boolean =>
  stored !== null && !('arrangement' in stored) && 'look' in stored && stored.look !== 'classic'

/** Calls the interface can make. */
export interface LookApi {
  /**
   * Focus mode: the window fills the screen (true), or goes back to how it was (false). A window that already
   * filled the screen before focus mode stays that way when it ends. Returns whether it fills the screen now.
   */
  setFullScreen(on: boolean): Promise<boolean>
}

/** Events from the main process. */
export interface LookEvents {
  /** The window started or stopped filling the screen (by setFullScreen, or some other way). */
  'look:fullScreen': { on: boolean }
}
