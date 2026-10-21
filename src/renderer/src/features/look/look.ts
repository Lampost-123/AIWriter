// The look: the New look ("Lamplight"), the only one since Classic was retired (2026-10-19; lookOf in contracts/look.ts
// always answers 'new'; a few Classic branches outside this folder still read it). It is painted as <html data-look>
// (styles.css sets its tokens).
// The New look's layout (Settings › Appearance › Layout) is kept here too: the desk or the panels, painted as
// <html data-arrangement> (layout/desk/desk.css), and known here for the shell (App.tsx's Workspace).
// Its own small store, so it never depends on the app's store.

import { useLayoutEffect } from 'react'
import { create } from 'zustand'
import { arrangementOf, lookOf, type Arrangement, type Look } from '@shared/contracts/look'

/** The look the window opened in (main passes it, as the theme), until settings say otherwise. */
const opening = (): Look => {
  try {
    return lookOf(window.aiwrite?.initialLook)
  } catch {
    return 'new'
  }
}

/** The layout shown until settings load: the panels (the window stays hidden until they have). */
export const useLookStore = create<{ look: Look; arrangement: Arrangement }>(() => ({ look: opening(), arrangement: 'panels' }))

/** The look on screen now. */
export const useLook = (): Look => useLookStore((s) => s.look)

/** True in the New look. */
export const useNewLook = (): boolean => useLookStore((s) => s.look === 'new')

/** True when the desk is on screen: the New look, laid out as the desk (Classic has no desk). */
export const useDesk = (): boolean => useLookStore((s) => s.look === 'new' && s.arrangement === 'desk')

/** The same, read once (for actions run outside React: the palette, a shortcut). */
export const deskOn = (): boolean => {
  const s = useLookStore.getState()
  return s.look === 'new' && s.arrangement === 'desk'
}

/** True when this build lets the desk be chosen (a try-out build, or once it is ready for everyone). */
export const deskReady = (): boolean => {
  try {
    return !!window.aiwrite?.deskReady
  } catch {
    return false
  }
}

/** Paints a look on the window now (before the setting is saved), so a choice in Settings shows at once. */
export function applyLook(value: unknown): void {
  const look = lookOf(value)
  document.documentElement.dataset.look = look
  if (useLookStore.getState().look !== look) useLookStore.setState({ look })
}

/** Paints a layout on the window now (before the setting is saved), so a choice in Settings shows at once. */
export function applyArrangement(value: unknown): void {
  const arrangement = arrangementOf(value)
  document.documentElement.dataset.arrangement = arrangement
  if (useLookStore.getState().arrangement !== arrangement) useLookStore.setState({ arrangement })
}

/** Keeps the window's look in step with the setting; until settings load (undefined) it keeps the look it opened in. */
export function useLookSetting(look: string | undefined): void {
  useLayoutEffect(() => {
    if (look !== undefined) applyLook(look)
  }, [look])
}

/** Keeps the window's layout in step with the setting, once settings have loaded. */
export function useArrangementSetting(arrangement: string | undefined, loaded: boolean): void {
  useLayoutEffect(() => {
    if (loaded) applyArrangement(arrangement ?? 'panels')
  }, [arrangement, loaded])
}
