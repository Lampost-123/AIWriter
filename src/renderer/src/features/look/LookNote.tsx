// The one-time note about the New look: after updating from a version before it, a small card says the look has
// changed and offers Classic. Either answer (or closing it) puts it away for good (Settings.lookNote, read in
// src/main/settings.ts); Settings › Appearance › Style switches back and forth any time after.
import { X } from '@/components/ui/icons'
import { Button, IconButton } from '@/components/ui'
import { useApp } from '@/lib/store'
import { chooseLook } from './LookPicker'
import { useNewLook } from './look'

const done = (): void => {
  const app = useApp.getState()
  if (app.settings) useApp.setState({ settings: { ...app.settings, lookNote: false } })
  void app.updateSettings({ lookNote: false })
}

export function LookNote(): React.JSX.Element | null {
  const due = useApp((s) => !!s.settings?.lookNote)
  const isNew = useNewLook()
  if (!due || !isNew) return null
  return (
    <section
      aria-label="The new look"
      className="fixed bottom-5 left-5 z-40 w-[340px] rounded-card bg-raise p-4 shadow-e3 ring-1 ring-line animate-[look-note-in_var(--dur-base)_var(--ease-spring)_both]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-semibold text-fg">AI Write has a new look</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Warmer colours, a colour for each kind of thing in your world, and four areas down the side. Prefer how it was? Switch back now, or any time in
            Settings › Appearance.
          </p>
        </div>
        <IconButton label="Close" size="sm" onClick={done} className="-mr-1 -mt-1">
          <X size={14} />
        </IconButton>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => chooseLook('classic')}>
          Switch to Classic
        </Button>
        <Button size="sm" variant="primary" onClick={done}>
          Keep the new look
        </Button>
      </div>
    </section>
  )
}
