import { createContext, type ComponentType } from 'react'

/**
 * Settings' "Saved" note (features/settings/SettingsSaved.tsx provides it): which section a change was last saved
 * from, and the note to show in that section's heading. Outside Settings there is none, and SettingsSection shows nothing.
 */
export interface SettingsSavedValue {
  /** The section element (`[data-settings-section]`) the last saved change was made in. */
  savedIn: Element | null
  Note: ComponentType<{ saved: boolean }>
}

export const SettingsSavedContext = createContext<SettingsSavedValue | null>(null)
