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
 * The two looks (Settings › Appearance › Style): the New look ("Lamplight") and Classic, the app as it was before
 * it. Kept in Settings as `look`, painted as <html data-look>; the window opens in it (--aiwrite-look=…, as the
 * theme), so nothing flashes. See docs/ARCHITECTURE.md, "The two looks".
 */
export const LOOKS = ['new', 'classic'] as const
export type Look = (typeof LOOKS)[number]

/** The look as kept in Settings: Classic only when it says so, the New look for anything else. */
export const lookOf = (value: unknown): Look => (value === 'classic' ? 'classic' : 'new')

/**
 * Whether the one-time note offering Classic is due when settings are read: only for someone who used AI Write
 * before the New look (their settings.json exists but has never had a look in it). A fresh install starts in the
 * New look with nothing to compare it with, so no note.
 */
export const lookNoteDue = (stored: Record<string, unknown> | null): boolean => stored !== null && !('look' in stored)

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
