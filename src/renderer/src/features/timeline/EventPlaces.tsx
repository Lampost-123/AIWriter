// Put events in their place (2026-10-19), on the timeline: when earlier builds left events at the story's start that the
// record can put at the scene each happens in, a line under the header says how many, lists them on "Show which" (each
// with its scene and why, and a tick to leave one where it is), and moves them with "Move them". One Undo on the toast
// puts them all back. "Not now" hides the offer on this computer until another event can move.
import { useState } from 'react'
import type { EventHome } from '@shared/contracts/worldViews'
import type { ID } from '@shared/types'
import { Button, Checkbox, toast } from '@/components/ui'
import { ChevronDown, MapPin } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { movedWords, NONE_MOVED, OFFER_DETAIL, offerWords, picked, readSkips, SKIP_KEY, skipped, skipValue, WHY_WORDS } from './eventPlacesLogic'

const skipsNow = (): Record<string, string> => {
  try {
    return readSkips(localStorage.getItem(SKIP_KEY))
  } catch {
    return {}
  }
}

export function EventPlaces({ storyId, homes }: { storyId: ID; homes: EventHome[] }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id ?? '')
  const key = `${worldId}:${storyId}`
  const [skips, setSkips] = useState(skipsNow)
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState<Set<ID>>(() => new Set())
  const [busy, setBusy] = useState(false)
  if (!homes.length || skipped(skips[key], homes)) return null
  const chosen = picked(homes, off)

  const notNow = (): void => {
    const next = { ...skipsNow(), [key]: skipValue(homes) }
    setSkips(next)
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify(next))
    } catch {
      // Not kept on this computer: it hides until the timeline opens again.
    }
  }

  const move = async (): Promise<void> => {
    if (busy || !chosen.length) return
    setBusy(true)
    try {
      const moves = await api.placeEvents(storyId, chosen)
      setOff(new Set())
      setOpen(false)
      if (!moves.length) {
        toast(NONE_MOVED)
        return
      }
      useApp.getState().bumpMemory()
      toast(movedWords(moves.length), {
        tone: 'success',
        action: {
          label: 'Undo',
          run: () =>
            void api
              .unplaceEvents(moves)
              .then(() => useApp.getState().bumpMemory())
              .catch((e: unknown) => toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' }))
        }
      })
    } catch (e) {
      toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Put events in their place" className="tl-places shrink-0 border-b border-line bg-surface-2 px-7 py-2.5" data-event-places>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <MapPin size={16} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-[240px] flex-1 text-[13px] leading-snug">
          <p className="font-medium text-fg">{offerWords(homes.length)}</p>
          <p className="text-muted">{OFFER_DETAIL}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            icon={<ChevronDown size={14} className={cn('transition-transform duration-(--dur-quick)', open && 'rotate-180')} />}
          >
            {open ? 'Hide' : 'Show which'}
          </Button>
          <Button size="sm" variant="ghost" onClick={notNow}>
            Not now
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!chosen.length} onClick={() => void move()}>
            {chosen.length === homes.length ? 'Move them' : `Move ${chosen.length}`}
          </Button>
        </div>
      </div>
      {open ? (
        <ul aria-label="Events to move" className="mt-2 max-h-[38vh] overflow-y-auto rounded-md border border-line bg-surface">
          {homes.map((h) => {
            const id = `place-${h.entryId}`
            return (
              <li key={h.entryId} className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-[13px] last:border-b-0">
                <Checkbox
                  id={id}
                  size="sm"
                  className="translate-y-0.5"
                  checked={!off.has(h.entryId)}
                  onChange={(on) =>
                    setOff((was) => {
                      const next = new Set(was)
                      if (on) next.delete(h.entryId)
                      else next.add(h.entryId)
                      return next
                    })
                  }
                />
                <label htmlFor={id} className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{h.name}</span>
                  <span className="text-muted"> to {h.place}</span>
                  <span className="text-faint"> · {WHY_WORDS[h.why]}</span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
