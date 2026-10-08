// The AI planning pages on the desk (UI overhaul, "the AI planning pages"): the outline helper, planning a chapter, a story
// planned from a recipe, the world builder, the recipe library and maker. Each is a crafted part of the desk, not a form:
// a header band with the page's drawing (PlanArt), what it is in one plain line, and, where the page is a wizard, its
// steps on a rail (each with its icon and how it stands, a thread of progress under them). Below, two columns: what
// Adam writes and chooses on the left, and on the right the AI's work as it arrives, as cards lying on the desk. In a
// narrower room (a window that isn't full screen) the columns stack and the page scrolls as one. Only on the desk: the
// panels and Classic keep their pages as they were.
import { forwardRef, type ReactNode } from 'react'
import { Lightbulb, type IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { PlanArt, type PlanArtName } from './PlanArt'
import { stepsProgress, type PlanStep } from './planLogic'
import './planning.css'

export interface PlanPageProps {
  art: PlanArtName
  kicker: string
  kickerIcon: IconType
  title: ReactNode
  /** What the page does, in one plain line. */
  line: ReactNode
  /** Above the kicker: a way back (the recipe pages). */
  back?: ReactNode
  steps?: { steps: PlanStep[]; icons: Record<string, IconType> } | null
  /** The left column: what Adam writes and chooses. */
  left: ReactNode
  /** The right column: the AI's work. */
  right: ReactNode
  /** Under both columns, across the page (a bar of actions). */
  foot?: ReactNode
  className?: string
}

/** A page of its own on the desk: the header band, then the two columns. */
export const PlanPage = forwardRef<HTMLDivElement, PlanPageProps & { leftRef?: React.Ref<HTMLDivElement>; rightRef?: React.Ref<HTMLDivElement> }>(function PlanPage(
  { art, kicker, kickerIcon, title, line, back, steps, left, right, foot, className, leftRef, rightRef },
  ref
) {
  return (
    <div ref={ref} data-plan-page={art} className={cn('plan-page', className)}>
      <PlanBand art={art} kicker={kicker} kickerIcon={kickerIcon} title={title} line={line} back={back}>
        {steps ? <StepRail steps={steps.steps} icons={steps.icons} /> : null}
      </PlanBand>
      <div className="plan-cols">
        <div ref={leftRef} className="plan-col plan-col-l overflow-y-auto" data-plan-col="left">
          <div className="plan-col-in">{left}</div>
        </div>
        <div ref={rightRef} className="plan-col plan-col-r overflow-y-auto" data-plan-col="right">
          <div className="plan-col-in">{right}</div>
        </div>
      </div>
      {foot}
    </div>
  )
})

/** The header band: the page's drawing in the lamp's light, its kicker, name and one plain line, and beside them its steps (or anything else). */
export function PlanBand({
  art,
  kicker,
  kickerIcon: Kicker,
  title,
  line,
  back,
  children
}: Pick<PlanPageProps, 'art' | 'kicker' | 'kickerIcon' | 'title' | 'line' | 'back'> & { children?: ReactNode }): React.JSX.Element {
  return (
    <header className="plan-band">
      <span className="plan-band-light" aria-hidden />
      <PlanArt name={art} className="plan-band-art" />
      <div className="plan-band-text">
        {back}
        <p className="plan-kicker">
          <Kicker size={13} aria-hidden />
          <span>{kicker}</span>
        </p>
        <h1 className="plan-title">{title}</h1>
        <p className="plan-line">{line}</p>
      </div>
      {children}
    </header>
  )
}

/** The page's steps: each its icon in a ring (ticked when done, amber while the AI works on it), its name and how it stands. */
export function StepRail({ steps, icons }: { steps: PlanStep[]; icons: Record<string, IconType> }): React.JSX.Element {
  const progress = stepsProgress(steps)
  return (
    <ol className="plan-steps" aria-label="Steps">
      <span className="plan-steps-track" aria-hidden>
        <i style={{ transform: `scaleY(${progress})` }} />
      </span>
      {steps.map((s, i) => {
        const Icon = icons[s.id]
        return (
          <li key={s.id} className={cn('plan-step', `is-${s.state}`)} aria-current={s.state === 'now' || s.state === 'working' ? 'step' : undefined} data-step={s.id}>
            <span className="plan-step-ring" aria-hidden>
              {s.state === 'done' ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="plan-step-tick">
                  <path d="M3.5 8.5 L 6.6 11.4 L 12.5 4.8" pathLength={1} />
                </svg>
              ) : Icon ? (
                <Icon size={15} />
              ) : (
                <span className="tabular-nums">{i + 1}</span>
              )}
            </span>
            <span className="plan-step-words">
              <span className="plan-step-label">{s.label}</span>
              <span className="plan-step-sub">{s.sub}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** A small heading in a column: small capitals, a hairline, and anything beside it. */
export function ColumnHead({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('plan-colhead', className)}>
      <h2 className="plan-colhead-t">{title}</h2>
      <span className="plan-colhead-rule" aria-hidden />
      {children}
    </div>
  )
}

/** The right column before the AI has done anything: a picture of what will come, what it is, and an example. */
export function ResultsEmpty({ title, children, example }: { title: string; children: ReactNode; example?: ReactNode }): React.JSX.Element {
  return (
    <div className="plan-empty" data-plan-empty>
      <div className="plan-empty-cards" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p className="plan-empty-t">{title}</p>
      <div className="plan-empty-s">{children}</div>
      {example ? (
        <div className="plan-example">
          <span className="plan-example-k">
            <Lightbulb size={12} aria-hidden /> For example
          </span>
          {example}
        </div>
      ) : null}
    </div>
  )
}
