// The one-time note about the New look: after updating from a version before it, a small card says the look has
// changed and offers Classic. Either answer (or closing it) puts it away for good (Settings.lookNote, read in
// src/main/settings.ts); Settings › Appearance › Style switches back and forth any time after.
// Its second form is about the desk: someone already on the New look who is moved to the desk is told so once, with
// the panels a click away (Settings.arrangementNote); Settings › Appearance › Layout switches any time after.
import { X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { LampMark } from '@/layout/desk/DeskTopBar'
import { Button, IconButton } from '@/components/ui'
import { useApp } from '@/lib/store'
import { chooseArrangement, chooseLook } from './LookPicker'
import { useDesk, useNewLook } from './look'

const done = (): void => {
  const app = useApp.getState()
  if (app.settings) useApp.setState({ settings: { ...app.settings, lookNote: false } })
  void app.updateSettings({ lookNote: false })
}

const deskDone = (): void => {
  const app = useApp.getState()
  if (app.settings) useApp.setState({ settings: { ...app.settings, arrangementNote: false } })
  void app.updateSettings({ arrangementNote: false })
}

const card =
  'fixed bottom-5 left-5 z-40 w-[340px] rounded-card bg-raise p-4 shadow-e3 ring-1 ring-line animate-[look-note-in_var(--dur-base)_var(--motion-spring)_both]'

export function LookNote(): React.JSX.Element | null {
  const due = useApp((s) => !!s.settings?.lookNote)
  const deskDue = useApp((s) => !!s.settings?.arrangementNote)
  const isNew = useNewLook()
  const desk = useDesk()
  if (isNew && !due && deskDue && desk) {
    return (
      // On the desk: at the bottom right, clear of the spine and the AI dock, on a slip of the desk's paper.
      <section aria-label="The desk" className={cn(card, 'desk-note-card left-auto right-5 w-[360px]')}>
        <div className="flex items-start gap-3">
          <span aria-hidden className="desk-mark mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
            <LampMark />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[16px] font-semibold text-fg">The new desk</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Your page sits in the middle, your chapters and scenes are on the spine at the left, and Write, Plan, World and Check are at the top.
              Prefer the panels? Switch back now, or any time in Settings › Appearance.
            </p>
          </div>
          <IconButton label="Close" size="sm" onClick={deskDone} className="-mr-1 -mt-1">
            <X size={14} />
          </IconButton>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => chooseArrangement('panels')}>
            Use the panels
          </Button>
          <Button size="sm" variant="primary" onClick={deskDone}>
            Keep the desk
          </Button>
        </div>
      </section>
    )
  }
  if (!due || !isNew) return null
  return (
    <section aria-label="The new look" className={card}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-semibold text-fg">AI Write has a new look</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Warmer colours, a colour for each kind of thing in your world, and {desk ? 'the page in the middle of a lit desk' : 'four areas down the side'}.
            Prefer how it was? Switch back now, or any time in Settings › Appearance.
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
