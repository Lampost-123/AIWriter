// The New look's frame for the first-run setup, a welcoming first chapter: on the left a rail of the five steps with
// their icons and a line that fills as Adam goes; in the middle the step itself on a sheet of paper; on the right the
// headland at dusk with the lighthouse being lit step by step (SetupScene.tsx), a line under it saying what is
// happening. Finishing lights the lamp fully and says so on the sheet for a moment (about 900 ms) before the first
// scene opens. In a narrower window the rail folds into a line of five segments over the sheet, and below about
// 1100 px the picture steps aside. Classic keeps its single column (FirstRun.tsx).
import type { ReactNode } from 'react'
import { SETUP_STEPS, type SetupStep } from '@shared/contracts/setup'
import { Compass, Cpu, Feather, Globe2, Network, type IconType } from '@/components/ui/icons'
import { DrawnTick } from '@/components/ui/DrawnTick'
import { cn } from '@/lib/cn'
import { STEP_NAMES, stepNumber } from './setupLogic'
import { SetupScene } from './SetupScene'
import { useSetup } from './setupStore'
import './setup.css'

const STEP_ICONS: Record<SetupStep, IconType> = {
  world: Globe2,
  connect: Network,
  model: Cpu,
  style: Feather,
  builder: Compass
}

/** Each step's line under its name on the rail. */
const STEP_HINTS: Record<SetupStep, string> = {
  world: 'Made as soon as you name it',
  connect: 'Your key stays on this computer',
  model: 'The voice that drafts your scenes',
  style: 'Point of view, tense, spelling',
  builder: 'Optional: describe it in your words'
}

/** What the picture's line says at each step, and when the setup is done. */
const CAPTIONS: Record<SetupStep | 'done', string> = {
  world: 'Dusk over the harbour. Every world begins somewhere quiet.',
  connect: 'A light comes on in the keeper’s house.',
  model: 'The keeper starts up the hundred and twelve steps.',
  style: 'Nearly at the top. The lamp room warms.',
  builder: 'The lamp is lit.',
  done: 'The light is on. Your world is ready.'
}

export function SetupDesk({ step, children }: { step: SetupStep; children: ReactNode }): React.JSX.Element {
  const n = stepNumber(step)
  const finishing = useSetup((s) => s.finishing)
  const caption = finishing ? CAPTIONS.done : CAPTIONS[step]
  return (
    <div className="setup-desk flex h-full min-h-0" data-setup-step={step}>
      <div className="flex min-w-0 flex-1 justify-center gap-10 pl-8 pr-6 min-[1500px]:gap-14 min-[1500px]:pl-12">
        {/* The rail: the five steps, wide windows only. */}
        <aside aria-label="Setup steps" className="setup-rail hidden w-[256px] shrink-0 flex-col pt-[7vh] min-[1280px]:flex">
          <Welcome />
          <ol className="relative mt-9 flex flex-col gap-1" style={{ '--setup-fill': (n - 1) / (SETUP_STEPS.length - 1) } as React.CSSProperties}>
            {/* The line behind the nodes, filled up to the step showing. */}
            <span aria-hidden className="setup-rail-line" />
            <span aria-hidden className="setup-rail-line setup-rail-fill" />
            {SETUP_STEPS.map((s, i) => {
              const Icon = STEP_ICONS[s]
              const state = i + 1 < n || finishing ? 'done' : i + 1 === n ? 'now' : 'later'
              return (
                <li key={s} aria-current={state === 'now' ? 'step' : undefined} data-state={state} className="setup-rail-step relative flex items-start gap-3 py-2">
                  <span className="setup-node grid h-9 w-9 shrink-0 place-items-center rounded-full">
                    {state === 'done' ? <DrawnTick size={16} draw /> : <Icon size={17} selected={state === 'now'} />}
                  </span>
                  <span className="min-w-0 pt-[3px]">
                    <span className="block text-[13.5px] font-medium leading-tight">{STEP_NAMES[s]}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-faint">{STEP_HINTS[s]}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="mt-auto pb-8 text-[12px] leading-relaxed text-faint">
            Everything saves as you go. Close AI Write at any point and you’ll come back to this step.
          </p>
        </aside>
        {/* The step on its sheet. */}
        <div className="flex w-full min-w-0 max-w-[700px] flex-col pt-[5vh]">
          <div className="min-[1280px]:hidden">
            <Welcome />
            <CompactProgress step={step} />
          </div>
          <div className="setup-sheet relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="px-12 pb-0 pt-11 max-[1400px]:px-9">
              <p className="setup-eyebrow">
                Step {n} of {SETUP_STEPS.length} · {STEP_NAMES[step]}
              </p>
              {children}
            </div>
            {finishing ? <Finished build={finishing === 'build'} /> : null}
          </div>
        </div>
      </div>
      {/* The headland, the lamp lit step by step. */}
      <div aria-hidden className="setup-art relative hidden shrink-0 p-3 pl-0 min-[1100px]:block">
        <SetupScene stage={n} finishing={!!finishing} className="h-full w-full rounded-[22px]" />
        <p key={caption} className="setup-caption">
          {caption}
        </p>
      </div>
    </div>
  )
}

function Welcome(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="setup-mark grid h-10 w-10 shrink-0 place-items-center rounded-[12px]" aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21h6M10 21l.6-9h2.8l.6 9" />
          <path d="M8.5 12h7M9.5 12V8h5v4" />
          <path d="M9 8l3-3 3 3" />
          <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <div className="min-w-0">
        <h1 className="whitespace-nowrap font-heading text-[20px] font-semibold leading-tight tracking-[-0.01em] text-fg">Welcome to AI Write</h1>
        <p className="text-[12.5px] text-muted">A few steps and you’re writing.</p>
      </div>
    </div>
  )
}

/** In a narrower window: the five steps as a line of segments, with the step's icon and name. */
function CompactProgress({ step }: { step: SetupStep }): React.JSX.Element {
  const n = stepNumber(step)
  return (
    <div className="mb-4 mt-5" aria-hidden>
      <div className="flex gap-1.5">
        {SETUP_STEPS.map((s, i) => (
          <span key={s} className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-line-strong">
            {i < n ? <span className={cn('absolute inset-0 origin-left bg-accent', i === n - 1 && 'animate-[fill-x_700ms_var(--motion-glide)_150ms_both]')} /> : null}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The moment the setup ends: the sheet says the lamp is lit, a tick drawing itself, before the first scene opens. */
function Finished({ build }: { build: boolean }): React.JSX.Element {
  return (
    <div role="status" className="setup-finished absolute inset-0 z-20 grid place-items-center">
      <div className="flex flex-col items-center text-center">
        <span className="setup-finished-tick grid h-14 w-14 place-items-center rounded-full">
          <DrawnTick size={26} draw />
        </span>
        <p className="mt-5 font-heading text-[30px] font-semibold tracking-[-0.015em] text-fg">The lamp is lit</p>
        <p className="mt-1.5 text-[13.5px] text-muted">{build ? 'Opening the World builder…' : 'Opening your first scene…'}</p>
      </div>
    </div>
  )
}
