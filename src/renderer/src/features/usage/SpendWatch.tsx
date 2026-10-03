// The monthly limit in the window (milestone 6, Usage and cost), mounted once in App:
// - one quiet toast a month at 80% of the limit ("Usage and cost" opens the page), and one when the limit is
//   reached (memory updates pause; "Carry on this month" lets everything go again; AI Write asks before
//   anything Adam starts);
// - the ask, when an AI action Adam starts is refused at the limit (lib/api.ts calls `askAtLimit`):
//   "This month's AI spending has reached your $20 limit." [Carry on this month] [Not now]. Carry on makes the
//   same call again; Not now (or Esc) leaves it unstarted. Several refused at once share one ask.
import { useEffect, useRef, useState } from 'react'
import { dollars, limitDollars, reachedWords, type SpendState } from '@shared/contracts/usage'
import { Button, Dialog, toast } from '@/components/ui'
import { api, onEvent, setAskAtLimit } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { carryOn, setSpend, useSpend } from './spendStore'

/** The first look waits until the window has settled, so it never slows the start. */
const FIRST_LOOK_MS = 2500

export const openUsage = (): void => useApp.getState().navigate({ kind: 'settings', tab: 'usage' })

async function carryOnFromToast(): Promise<void> {
  try {
    await carryOn()
    toast('Carrying on this month. AI Write won’t ask again until next month or until you change the limit.', { tone: 'success' })
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}

export function SpendWatch(): React.JSX.Element {
  const shown = useRef(new Set<string>())
  const [ask, setAsk] = useState<{ message: string } | null>(null)
  const waiting = useRef<{ promise: Promise<boolean>; resolve: (yes: boolean) => void } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const look = (s: SpendState): void => {
      setSpend(s)
      if (!s.toast || s.limit == null) return
      const key = `${s.month}:${s.limit}:${s.toast}`
      if (shown.current.has(key)) return
      shown.current.add(key)
      if (s.toast === 'near') {
        toast(`You’ve spent ${dollars(s.spent)} of your ${limitDollars(s.limit)} AI limit this month.`, {
          action: { label: 'Usage and cost', run: openUsage }
        })
      } else {
        // Short, with one button, so the words keep their room beside it.
        toast(`${reachedWords(s.limit)} Memory updates are paused.`, {
          action: { label: 'Carry on this month', run: () => void carryOnFromToast() }
        })
      }
      void api
        .spendToastShown(s.toast)
        .then(setSpend)
        .catch(() => undefined)
    }
    const off = onEvent('usage:spend', look)
    const t = setTimeout(() => {
      void api
        .getSpendState()
        .then(look)
        .catch(() => undefined)
    }, FIRST_LOOK_MS)
    return () => {
      off()
      clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    setAskAtLimit((message) => {
      if (waiting.current) return waiting.current.promise
      let resolve!: (yes: boolean) => void
      const promise = new Promise<boolean>((r) => (resolve = r))
      waiting.current = { promise, resolve }
      setAsk({ message })
      void api
        .getSpendState()
        .then(setSpend)
        .catch(() => undefined)
      return promise
    })
    return () => setAskAtLimit(null)
  }, [])

  const answer = (yes: boolean): void => {
    const w = waiting.current
    waiting.current = null
    setAsk(null)
    w?.resolve(yes)
  }

  const carry = async (): Promise<void> => {
    setBusy(true)
    try {
      await carryOn()
      answer(true)
    } catch (e) {
      toast(plainReason(e), { tone: 'danger' })
      answer(false)
    } finally {
      setBusy(false)
    }
  }

  const state = useSpend((s) => s.state)
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(open) => {
        if (!open && !busy) answer(false)
      }}
      title={ask?.message ?? ''}
      description={
        <>
          {state && state.limit != null ? <>So far this month: {dollars(state.spent)}. </> : null}
          Carry on, and AI Write won’t ask again until next month or until you change the limit.
        </>
      }
      width={460}
      footer={
        <>
          <Button onClick={() => answer(false)} disabled={busy}>
            Not now
          </Button>
          <Button variant="primary" data-autofocus loading={busy} onClick={() => void carry()}>
            Carry on this month
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-faint">
        You can raise or remove the limit on the{' '}
        <button
          type="button"
          className="font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={() => {
            answer(false)
            openUsage()
          }}
        >
          Usage and cost
        </button>{' '}
        page.
      </p>
    </Dialog>
  )
}
