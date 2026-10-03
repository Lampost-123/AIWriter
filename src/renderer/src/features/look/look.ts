// The two looks (Settings › Appearance › Style): the New look ("Lamplight") and Classic. The look is painted as
// <html data-look> (styles.css sets the tokens for each), and is known here for what draws differently in code: the
// icons (components/ui/icons.tsx) and the shell (the area rail in the New look, today's binder in Classic).
// Its own small store, so the icons never depend on the app's store.

import { useLayoutEffect } from 'react'
import { create } from 'zustand'
import { lookOf, type Look } from '@shared/contracts/look'

/** The look the window opened in (main passes it, as the theme), until settings say otherwise. */
const opening = (): Look => {
  try {
    return lookOf(window.aiwrite?.initialLook)
  } catch {
    return 'new'
  }
}

export const useLookStore = create<{ look: Look }>(() => ({ look: opening() }))

/** The look on screen now. */
export const useLook = (): Look => useLookStore((s) => s.look)

/** True in the New look. */
export const useNewLook = (): boolean => useLookStore((s) => s.look === 'new')

/** Paints a look on the window now (before the setting is saved), so a choice in Settings shows at once. */
export function applyLook(value: unknown): void {
  const look = lookOf(value)
  document.documentElement.dataset.look = look
  if (useLookStore.getState().look !== look) useLookStore.setState({ look })
}

/** Keeps the window's look in step with the setting; until settings load (undefined) it keeps the look it opened in. */
export function useLookSetting(look: string | undefined): void {
  useLayoutEffect(() => {
    if (look !== undefined) applyLook(look)
  }, [look])
}
