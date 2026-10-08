// One step of the first-run setup (milestone 6): its heading and words, what it asks, and Back, Skip and Continue.

import { ArrowLeft } from '@/components/ui/icons'
import type { ReactNode } from 'react'
import type { SetupStep } from '@shared/contracts/setup'
import { Button } from '@/components/ui'
import { nextStep, previousStep } from './setupLogic'
import { useSetup } from './setupStore'

/** One step: its heading and words, what it asks, and Back, Skip and Continue along the bottom. */
export function StepFrame({
  title,
  intro,
  children,
  back,
  skip,
  next
}: {
  title: string
  intro: ReactNode
  children?: ReactNode
  back?: () => void
  skip?: { label: string; run: () => void }
  next?: { label: string; run: () => void; disabled?: boolean; loading?: boolean }
}): React.JSX.Element {
  return (
    <section aria-labelledby="setup-step-title">
      <h2 id="setup-step-title" className="text-[18px] font-semibold text-fg look-new:font-heading look-new:text-[34px] look-new:leading-[1.1] look-new:tracking-[-0.015em]">
        {title}
      </h2>
      <div className="mb-5 mt-1.5 text-[13.5px] leading-relaxed text-muted">{intro}</div>
      {children}
      {back || skip || next ? (
        // Kept in sight at the window's foot while a long step scrolls (a provider added, the style cards), so Continue
        // is never below the edge.
        <div className="sticky bottom-0 z-10 mt-7 flex items-center gap-2 border-t border-line bg-bg pb-4 pt-4">
          {back ? (
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={back}>
              Back
            </Button>
          ) : null}
          <span className="flex-1" />
          {skip ? (
            <Button variant="ghost" onClick={skip.run}>
              {skip.label}
            </Button>
          ) : null}
          {next ? (
            <Button variant="primary" size="lg" disabled={next.disabled} loading={next.loading} onClick={next.run}>
              {next.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** Moves the setup on from a step (or back), remembering where it is. */
export const goNext = (step: SetupStep): void => void useSetup.getState().go(nextStep(step) ?? step)
export const goBack = (step: SetupStep): void => void useSetup.getState().go(previousStep(step) ?? step)
