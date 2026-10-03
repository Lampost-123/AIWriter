// One step of the first-run setup (milestone 6): its heading and words, what it asks, and Back, Skip and Continue.

import { ArrowLeft } from 'lucide-react'
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
      <h2 id="setup-step-title" className="text-[18px] font-semibold text-fg">
        {title}
      </h2>
      <div className="mb-5 mt-1.5 text-[13.5px] leading-relaxed text-muted">{intro}</div>
      {children}
      {back || skip || next ? (
        <div className="mt-7 flex items-center gap-2 border-t border-line pt-4">
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
