// The one-time notes about the look, each shown once and put away for good by its answer (or by closing it):
//  - Classic has been retired (2026-10-19): someone whose settings still kept Classic was moved to the New look, with
//    every other setting kept (Settings.classicNote, set in src/main/settings.ts). Nothing to choose: it just says so.
//  - The New look: after updating from a version before it, a small card says the look has changed (Settings.lookNote).
//    On the desk it offers the panels, the layout closest to how the app was.
//  - The desk: someone already on the New look who is moved to the desk is told so once, with the panels a click away
//    (Settings.arrangementNote).
// Settings › Appearance › Layout switches between the desk and the panels any time after.
import { X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { LampMark } from '@/layout/desk/DeskTopBar'
import { Button, IconButton } from '@/components/ui'
import { useApp } from '@/lib/store'
import { chooseArrangement } from './LookPicker'
import { useDesk } from './look'

type NoteKey = 'lookNote' | 'arrangementNote' | 'classicNote'

/** Puts a note away for good: at once on screen, then in Settings. */
const putAway = (key: NoteKey): void => {
  const app = useApp.getState()
  if (app.settings) useApp.setState({ settings: { ...app.settings, [key]: false } })
  void app.updateSettings({ [key]: false })
}

const card =
  'fixed bottom-5 left-5 z-40 w-[340px] rounded-card bg-raise p-4 shadow-e3 ring-1 ring-line animate-[look-note-in_var(--dur-base)_var(--motion-spring)_both]'
/** On the desk: at the bottom right, clear of the spine and the AI dock, on a slip of the desk's paper. */
const deskCard = cn(card, 'desk-note-card left-auto right-5 w-[360px]')

/** The desk's lamp, beside a note's words on the desk. */
function DeskMark(): React.JSX.Element {
  return (
    <span aria-hidden className="desk-mark mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
      <LampMark />
    </span>
  )
}

export function LookNote(): React.JSX.Element | null {
  const classicDue = useApp((s) => !!s.settings?.classicNote)
  const due = useApp((s) => !!s.settings?.lookNote)
  const deskDue = useApp((s) => !!s.settings?.arrangementNote)
  const desk = useDesk()
  if (classicDue) {
    const done = (): void => putAway('classicNote')
    return (
      <section aria-label="Classic has been retired" className={desk ? deskCard : card}>
        <div className="flex items-start gap-3">
          {desk ? <DeskMark /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[16px] font-semibold text-fg">Classic has been retired</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              AI Write now uses the New look. Your stories and settings are unchanged. You can choose between the desk and the panels any time in
              Settings › Appearance.
            </p>
          </div>
          <IconButton label="Close" size="sm" onClick={done} className="-mr-1 -mt-1">
            <X size={14} />
          </IconButton>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="primary" onClick={done}>
            Got it
          </Button>
        </div>
      </section>
    )
  }
  if (!due && deskDue && desk) {
    const done = (): void => putAway('arrangementNote')
    return (
      <section aria-label="The desk" className={deskCard}>
        <div className="flex items-start gap-3">
          <DeskMark />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[16px] font-semibold text-fg">The new desk</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Your page sits in the middle, your chapters and scenes are on the spine at the left, and Write, Plan, World and Check are at the top.
              Prefer the panels? Switch back now, or any time in Settings › Appearance.
            </p>
          </div>
          <IconButton label="Close" size="sm" onClick={done} className="-mr-1 -mt-1">
            <X size={14} />
          </IconButton>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => chooseArrangement('panels')}>
            Use the panels
          </Button>
          <Button size="sm" variant="primary" onClick={done}>
            Keep the desk
          </Button>
        </div>
      </section>
    )
  }
  if (!due) return null
  const done = (): void => putAway('lookNote')
  return (
    <section aria-label="The new look" className={card}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-semibold text-fg">AI Write has a new look</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Warmer colours, a colour for each kind of thing in your world, and {desk ? 'the page in the middle of a lit desk' : 'four areas down the side'}.{' '}
            {desk ? 'Prefer panels down the side? Switch now, or any time in Settings › Appearance.' : 'You can change the layout any time in Settings › Appearance.'}
          </p>
        </div>
        <IconButton label="Close" size="sm" onClick={done} className="-mr-1 -mt-1">
          <X size={14} />
        </IconButton>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {desk ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              chooseArrangement('panels')
              done()
            }}
          >
            Use the panels
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onClick={done}>
          Keep the new look
        </Button>
      </div>
    </section>
  )
}
