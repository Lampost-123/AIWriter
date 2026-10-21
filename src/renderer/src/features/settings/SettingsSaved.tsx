// A small "Saved" note in the heading of the Settings section a change was just made in (look-and-feel idea 7), so
// Adam always knows a change stuck. Settings save themselves (through the store's updateSettings, from many parts of
// the app), so rather than wire each one, this watches the page: the section last clicked, typed in or moved, and the
// settings changing within a few seconds of it. Only a real change counts: a save that fails (the settings are read
// again, unchanged) or a check that changes nothing shows no note.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsSavedContext } from '@/components/ui/settingsSaved'
import { useApp } from '@/lib/store'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { sameData } from './savedLogic'

/** How long after a click or a key in a section a change of the settings still counts as made there. */
const SAVE_WINDOW_MS = 4000

const EVENTS = ['pointerdown', 'keydown', 'input', 'change'] as const

function Note({ saved }: { saved: boolean }): React.JSX.Element {
  return <SaveNote status={saved ? 'saved' : 'idle'} className="min-w-0 justify-start" />
}

export function SettingsSaved({ children }: { children: ReactNode }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const last = useRef<{ section: Element | null; at: number } | null>(null)
  const [savedIn, setSavedIn] = useState<Element | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const touched = (e: Event): void => {
      const target = e.target instanceof Element ? e.target : null
      last.current = { section: target?.closest('[data-settings-section]') ?? null, at: performance.now() }
    }
    for (const k of EVENTS) el.addEventListener(k, touched, true)
    const off = useApp.subscribe((s, prev) => {
      if (!prev.settings || !s.settings || sameData(s.settings, prev.settings)) return
      const l = last.current
      if (!l?.section || !l.section.isConnected || performance.now() - l.at > SAVE_WINDOW_MS) return
      setSavedIn(l.section)
    })
    return () => {
      for (const k of EVENTS) el.removeEventListener(k, touched, true)
      off()
    }
  }, [])
  const value = useMemo(() => ({ savedIn, Note }), [savedIn])
  return (
    <SettingsSavedContext.Provider value={value}>
      <div ref={box}>{children}</div>
    </SettingsSavedContext.Provider>
  )
}
