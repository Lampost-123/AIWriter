// "Show beats" (2026-10-08): where each beat begins stays marked on the page after Beat by beat is finished (while
// writing beat by beat it always shows). In Settings › Editor, the palette (Show beats, Hide beats) and each beat's
// menu on the page. Off by default; saved at once. Owned by the Beat by beat part.
import { useId } from 'react'
import { SettingsSection, toast } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

/** Turns "Show beats" on or off (saved at once). */
export async function setShowBeats(on: boolean): Promise<void> {
  try {
    await useApp.getState().updateSettings({ editor: { showBeats: on } })
  } catch (e) {
    toast(`That change couldn't be saved. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/** Settings › Editor: Show beats. */
export function BeatSettings(): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.editor?.showBeats)
  const ready = useApp((s) => !!s.settings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Beat by beat">
      <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void setShowBeats(v)} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Show beats
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Keeps a thin line beside each beat written beat by beat after you finish, with its number in the margin. Click
            the number to write that beat again or take it out. While you write beat by beat, they always show.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
