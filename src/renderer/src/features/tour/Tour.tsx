// The guided tour: a card that walks Adam through the desk, one point at a time, with the thing it talks about
// lit up. Skip (or Esc) closes it for good; the last step's Finish does the same. It shows once, after the first-run
// setup, and the command bar's Show the tour brings it back from the first step.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, toast } from '@/components/ui'
import { useApp } from '@/lib/store'
import { useSetup } from '@/features/setup/setupStore'
import { stepAfter, stepBefore, TOUR_STEPS, type TourStep } from './tourSteps'
import { useTour } from './tourStore'

const CARD_W = 340
const GAP = 14
const PAD = 6

/** The window's desk look is on (the tour points at desk parts only). */
const onDesk = (): boolean => document.documentElement.dataset.arrangement === 'desk' && document.documentElement.dataset.look === 'new'

/** Closes the tour for good: remembered in Settings, so it does not show again on its own. */
async function finishTour(): Promise<void> {
  useTour.getState().close()
  try {
    await useApp.getState().updateSettings({ tourSeen: true })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

/** Shows the tour once, after the first-run setup, on a desk that has a world open and has not seen it yet. */
function useFirstTour(): void {
  const settings = useApp((s) => s.settings)
  const world = useApp((s) => s.world)
  const home = useApp((s) => s.home)
  const setupStep = useSetup((s) => s.step)
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current || !settings || !world || home || setupStep || !onDesk()) return
    checked.current = true
    if (!settings.tourSeen) useTour.getState().start()
  }, [settings, world, home, setupStep])
}

export function Tour(): React.JSX.Element | null {
  useFirstTour()
  const open = useTour((s) => s.open)
  const index = useTour((s) => s.index)
  const step = TOUR_STEPS[index]
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Measure the step's target when the step changes and when the window does (a room or the top bar may move).
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const el = step?.target ? document.querySelector<HTMLElement>(step.target) : null
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, step])

  // Esc skips; the arrows and Enter move. Keys are taken here while the tour is up, so the page never gets them.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const next = (): void => {
        const n = stepAfter(useTour.getState().index)
        if (n === null) void finishTour()
        else useTour.getState().go(n)
      }
      if (e.key === 'Escape') void finishTour()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') useTour.getState().go(stepBefore(useTour.getState().index))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open || !step) return null
  const last = stepAfter(index) === null
  const next = (): void => {
    const n = stepAfter(index)
    if (n === null) void finishTour()
    else useTour.getState().go(n)
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(8, 10, 16, 0.62)'
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/60" />
      )}
      <TourCard step={step} index={index} rect={rect} last={last} onNext={next} onBack={() => useTour.getState().go(stepBefore(index))} onSkip={() => void finishTour()} />
    </div>
  )
}

function TourCard({
  step,
  index,
  rect,
  last,
  onNext,
  onBack,
  onSkip
}: {
  step: TourStep
  index: number
  rect: DOMRect | null
  last: boolean
  onNext(): void
  onBack(): void
  onSkip(): void
}): React.JSX.Element {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const height = 200
  // Under the target when there is room, else above it, else in the middle; kept inside the window.
  let top = (vh - height) / 2
  let left = (vw - CARD_W) / 2
  if (rect) {
    left = rect.left + rect.width / 2 - CARD_W / 2
    if (rect.bottom + GAP + height < vh) top = rect.bottom + GAP
    else if (rect.top - GAP - height > 0) top = rect.top - GAP - height
  }
  left = Math.min(Math.max(16, left), vw - CARD_W - 16)
  top = Math.min(Math.max(16, top), vh - height - 16)

  return (
    <div
      className="fixed rounded-xl border border-line bg-surface p-5 text-fg shadow-2xl"
      style={{ left, top, width: CARD_W }}
    >
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        Step {index + 1} of {TOUR_STEPS.length}
      </p>
      <h2 id="tour-title" className="mt-1 font-heading text-[18px] leading-6">
        {step.title}
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-muted">{step.body}</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip tour
        </Button>
        <div className="flex gap-2">
          {index > 0 ? (
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" size="sm" autoFocus onClick={onNext}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
