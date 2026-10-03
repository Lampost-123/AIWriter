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
