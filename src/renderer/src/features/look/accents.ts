// The accent colours Adam can pick in Settings › Appearance (milestone 6, "Look and feel"): the theme's own, and
// four more, none of them amber, red or green (those mean an AI suggestion, a must-fix problem and done). Each has
// its colours tuned for Light, Dark and Sepia so text keeps WCAG AA contrast (accents.test.ts checks every one, and
// that styles.css has the same values: it is what paints them, by <html data-accent>).

import { useLayoutEffect } from 'react'
import type { PaintedTheme } from '@shared/api'
import { accentIdOf, type AccentId } from '@shared/contracts/look'

/** One accent in one theme: the --accent, --accent-hover, --accent-soft and --accent-fg tokens. */
export interface AccentColours {
  accent: string
  hover: string
  /** A quiet wash behind a selected row or a badge; accent text sits on it. */
  soft: string
  /** Text on a filled accent button. */
  fg: string
}

export interface AccentPreset {
  /** null: the theme's own accent. */
  id: AccentId | null
  label: string
  colours: Record<PaintedTheme, AccentColours>
}

export const ACCENTS: AccentPreset[] = [
  {
    id: null,
    label: 'Theme colour',
    colours: {
      light: { accent: '#3d5a80', hover: '#314a6b', soft: '#e3eaf3', fg: '#ffffff' },
      dark: { accent: '#8fb0dc', hover: '#a6c1e6', soft: '#263548', fg: '#10161f' },
      sepia: { accent: '#8a4b2a', hover: '#733e22', soft: '#ecd9c4', fg: '#fff8ec' }
    }
  },
  {
    id: 'teal',
    label: 'Teal',
    colours: {
      light: { accent: '#1d6b78', hover: '#175863', soft: '#dcedf0', fg: '#ffffff' },
      dark: { accent: '#6fbccb', hover: '#8ccbd7', soft: '#1c3a40', fg: '#0a1a1d' },
      sepia: { accent: '#1c5f69', hover: '#164e57', soft: '#d5e0d8', fg: '#fff8ec' }
    }
  },
  {
    id: 'indigo',
    label: 'Indigo',
    colours: {
      light: { accent: '#4a4fa3', hover: '#3d418a', soft: '#e6e7f6', fg: '#ffffff' },
      dark: { accent: '#a3a8f0', hover: '#b9bdf5', soft: '#2a2d4d', fg: '#12132a' },
      sepia: { accent: '#444a94', hover: '#383d7c', soft: '#dedbe0', fg: '#fff8ec' }
    }
  },
  {
    id: 'plum',
    label: 'Plum',
    colours: {
      light: { accent: '#7a3e6e', hover: '#66335c', soft: '#f2e4ef', fg: '#ffffff' },
      dark: { accent: '#d49cc6', hover: '#e0b4d4', soft: '#3b2537', fg: '#1f0f1b' },
      sepia: { accent: '#713a66', hover: '#5e3055', soft: '#ead6d6', fg: '#fff8ec' }
    }
  },
  {
    id: 'graphite',
    label: 'Graphite',
    colours: {
      light: { accent: '#4a4f57', hover: '#3b3f46', soft: '#e7e8ea', fg: '#ffffff' },
      dark: { accent: '#b4b8bf', hover: '#c9ccd2', soft: '#2e3034', fg: '#141518' },
      sepia: { accent: '#4a463f', hover: '#3b3832', soft: '#e2d8c4', fg: '#fff8ec' }
    }
  }
]

/** How the theme's own colour is described where it differs by theme. */
export const THEME_COLOUR_HINT = 'The theme’s own colour: ink blue in Light and Dark, russet in Sepia'

/**
 * Paints the accent on the window now (<html data-accent>), before the setting is saved, so a swatch picked
 * shows at once. Anything that isn't an accent there is goes back to the theme's own.
 */
export function applyAccent(value: unknown): void {
  const id = accentIdOf(value)
  const root = document.documentElement
  if (id) root.dataset.accent = id
  else delete root.dataset.accent
}

/**
 * Keeps the window's accent in step with the setting. Until settings load (undefined) it keeps the accent the
 * window opened in. Before paint, so a theme and its accent never show a frame apart.
 */
export function useAccent(accent: string | null | undefined): void {
  useLayoutEffect(() => {
    if (accent !== undefined) applyAccent(accent)
  }, [accent])
}
