// The first-run setup (milestone 6): shown in place of the Welcome screen on a fresh install. Five short steps,
// each saved as it goes: name the world (it is made there and then), connect an AI service and test it, pick the
// writer model, the basic style, and optionally lay the world out from a summary. Then the world's first scene
// opens with a small guide (FirstSceneGuide.tsx). Back goes to the step before; quitting midway resumes at the
// same step next time (setupStore.ts).

import { BookOpen, Feather, WandSparkles } from '@/components/ui/icons'
import { useRef, useState, type ReactNode } from 'react'
import { SETUP_STEPS, type SetupStep } from '@shared/contracts/setup'
import { Button, Field, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useLookStore, useNewLook } from '@/features/look/look'
import { reducedMotion } from '@/features/look/motion'
import { useApp } from '@/lib/store'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { openWorldBuilder } from '@/features/worldBuilder/open'
import { WelcomeActionButtons, WELCOME_ACTIONS, type WelcomeAction } from '@/features/welcome/welcomeActions'
import { nextStep, previousStep, STEP_NAMES, stepNumber } from './setupLogic'
import { goBack, StepFrame } from './StepFrame'
import { openSampleWorld, useSetup } from './setupStore'
import { ConnectStep } from './ConnectStep'
import { ModelStep } from './ModelStep'
import { StyleStep, type StyleSaver } from './StyleStep'
import { SetupDesk } from './SetupDesk'

export function FirstRun(): React.JSX.Element | null {
  const step = useSetup((s) => s.step)
  const isNew = useNewLook()
  if (!step) return null
  // The step itself: a new one fades in; the page never jumps sideways.
  const content = (
    <div key={step} className="animate-fade-in">
      {step === 'world' && <WorldStep />}
      {step === 'connect' && <ConnectStep />}
      {step === 'model' && <ModelStep />}
      {step === 'style' && <StyleStepFrame />}
      {step === 'builder' && <BuilderStep />}
    </div>
  )
  // The New look: the rail of steps, the step on a sheet, and the lighthouse being lit beside it (SetupDesk.tsx).
  if (isNew) return <SetupDesk step={step}>{content}</SetupDesk>
  return (
    <div className="flex h-full justify-center overflow-y-auto bg-bg px-6 pb-16 pt-[7vh] [scrollbar-gutter:stable_both-edges] look-new:bg-transparent">
      <div className="w-full max-w-[600px]">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <BookOpen size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[22px] font-semibold leading-tight text-fg">Welcome to AI Write</h1>
            <p className="text-[13px] text-muted">A few steps and you’re writing. Everything saves as you go.</p>
          </div>
        </div>
        <Progress step={step} />
        {content}
      </div>
    </div>
  )
}

/** Where Adam is: a calm line of five segments, and the step in words. */
function Progress({ step }: { step: SetupStep }): React.JSX.Element {
  const n = stepNumber(step)
  const isNew = useNewLook()
  return (
    <div className="mb-6">
      <div className="flex gap-1.5" aria-hidden>
        {SETUP_STEPS.map((s, i) => (
          <span
            key={s}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-200',
              i < n ? 'bg-accent' : 'bg-line',
              // The New look: a fuller line, the step reached filling in from the left.
              'look-new:relative look-new:h-[5px] look-new:overflow-hidden look-new:bg-line-strong'
            )}
          >
            {isNew && i < n ? (
              <span
                aria-hidden
                className={cn('absolute inset-0 origin-left bg-accent', i === n - 1 && 'animate-[fill-x_700ms_var(--motion-glide)_150ms_both]')}
              />
            ) : null}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-faint">
        Step {n} of {SETUP_STEPS.length} · {STEP_NAMES[step]}
      </p>
    </div>
  )
}

// ---------- 1. The world ----------

function WorldStep(): React.JSX.Element {
  const worldId = useSetup((s) => s.worldId)
  const world = useApp((s) => s.world)
  // Back from a later step: the world is made already, and this renames it.
  const made = !!worldId && world?.id === worldId ? world : null
  const [name, setName] = useState(made?.name ?? '')
  const [busy, setBusy] = useState<false | 'create' | 'sample'>(false)
  const isNew = useNewLook()

  const next = async (): Promise<void> => {
    const clean = name.trim()
    if (!clean || busy) return
    setBusy('create')
    try {
      if (made) {
        if (clean !== made.name) {
          await api.updateWorld({ name: clean })
          await useApp.getState().refreshWorld()
        }
      } else {
        await useApp.getState().createWorld(clean)
      }
      await useSetup.getState().go('connect')
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setBusy(false)
    }
  }

  const explore = async (): Promise<void> => {
    setBusy('sample')
    await openSampleWorld()
    setBusy(false)
  }

  return (
    <StepFrame
      title="Name your world"
      intro="A world holds the characters, places and lore that every story set in it shares. Give it a name for now; you can change it any time."
      next={{ label: 'Continue', run: () => void next(), disabled: !name.trim() || !!busy, loading: busy === 'create' }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void next()
        }}
      >
        <Field label="World name">
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              placeholder="For example, The Northern Reaches"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </form>
      {made ? null : isNew ? (
        <SampleWorldCard busy={busy} onExplore={() => void explore()} />
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13px] font-medium text-fg">Not sure yet?</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Look round a small finished world first: a short story with its characters, places and memory filled in. Nothing in it costs
            anything.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<BookOpen size={15} />} loading={busy === 'sample'} disabled={!!busy} onClick={() => void explore()}>
              Explore a sample world first
            </Button>
          </div>
          {WELCOME_ACTIONS.length ? <WelcomeActionButtons className="mt-2" actions={FROM_SETUP} /> : null}
        </div>
      )}
    </StepFrame>
  )
}

/**
 * The Welcome screen's other ways to start, from the setup's first step: the setup steps aside for them, as it does
 * for the sample world. A manuscript's import page shows in its place; a world file steps it aside once it opens.
 */
const FROM_SETUP: WelcomeAction[] = WELCOME_ACTIONS.map((a) =>
  a.id === 'import-manuscript'
    ? {
        ...a,
        run: () => {
          useSetup.getState().close()
          return a.run()
        }
      }
    : {
        ...a,
        run: async () => {
          await a.run()
          if (useApp.getState().world) useSetup.getState().close()
        }
      }
)

// ---------- 4. Style ----------

function StyleStepFrame(): React.JSX.Element {
  const saver = useRef<StyleSaver | null>(null)
  const leave = async (to: SetupStep | null): Promise<void> => {
    await saver.current?.save()
    if (to) void useSetup.getState().go(to)
  }
  return (
    <StepFrame
      title="How should your stories read?"
      intro="The AI writes every draft this way. These are your own writing preferences, for every world; each world and story can change them later in its style guide."
      back={() => void leave(previousStep('style'))}
      next={{ label: 'Continue', run: () => void leave(nextStep('style')) }}
    >
      <StyleStep saverRef={saver} />
    </StepFrame>
  )
}

// ---------- 5. Lay the world out, then the first scene ----------

function BuilderStep(): React.JSX.Element {
  const [busy, setBusy] = useState<false | 'build' | 'write'>(false)
  const finish = async (build: boolean): Promise<void> => {
    setBusy(build ? 'build' : 'write')
    try {
      await finishSetup(build)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setBusy(false)
    }
  }
  return (
    <StepFrame
      title="Lay out your world (optional)"
      intro="If you already know your world, describe it in your own words, from a paragraph to a few pages, and the AI lays out its characters, places, lore and plot threads for you. Or start writing and add things as you go."
      back={() => goBack('builder')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          icon={<WandSparkles size={17} />}
          title="Describe my world"
          text="Opens the World builder. Your first scene waits for you in the binder."
          loading={busy === 'build'}
          disabled={!!busy}
          onClick={() => void finish(true)}
        />
        <Choice
          icon={<Feather size={17} />}
          title="Start writing"
          text="Opens your first scene, with a short guide to writing it."
          primary
          loading={busy === 'write'}
          disabled={!!busy}
          onClick={() => void finish(false)}
        />
      </div>
    </StepFrame>
  )
}

function Choice({
  icon,
  title,
  text,
  primary,
  loading,
  disabled,
  onClick
}: {
  icon: ReactNode
  title: string
  text: string
  primary?: boolean
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border bg-surface p-4 text-left shadow-soft transition-colors duration-150 disabled:opacity-60',
        primary ? 'border-accent/50 hover:border-accent' : 'border-line hover:border-line-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        // The New look: a raised card that lifts on hover and presses in, a little taller.
        'look-new:min-h-[150px] look-new:rounded-[16px] look-new:border-transparent look-new:bg-raise look-new:p-5 look-new:shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)] look-new:transition-[box-shadow,translate,scale] look-new:duration-(--dur-quick) look-new:ease-glide look-new:enabled:hover:-translate-y-0.5 look-new:enabled:hover:shadow-[var(--elev-2),inset_0_0_0_1px_var(--line-strong)] look-new:enabled:active:scale-[0.98] look-new:enabled:active:duration-(--dur-press)',
        primary && 'look-new:shadow-[var(--elev-2),inset_0_0_0_1.5px_var(--accent)] look-new:enabled:hover:shadow-[var(--elev-2),inset_0_0_0_1.5px_var(--accent)]'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          primary ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'
        )}
      >
        {icon}
      </span>
      <span className="text-[14.5px] font-semibold text-fg">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-muted">{text}</span>
    </button>
  )
}

/** How long the setup's last moment plays in the New look (a rare moment: 500-900 ms). */
const FINISH_MS = 900

/**
 * Ends the setup: the world's first story, chapter and scene (made if missing) open, with the guide on that scene.
 * With `build`, the World builder opens over it.
 */
async function finishSetup(build: boolean): Promise<void> {
  // The New look: the lamp is lit on the picture and the sheet says so for a moment (900 ms, while the first scene is
  // made); at once with less motion, and never in Classic.
  const moment = useLookStore.getState().look === 'new' && !reducedMotion()
  if (moment) useSetup.setState({ finishing: build ? 'build' : 'write' })
  let made: Awaited<ReturnType<typeof api.finishSetup>>
  try {
    ;[made] = await Promise.all([api.finishSetup(), new Promise((r) => setTimeout(r, moment ? FINISH_MS : 0))])
  } catch (e) {
    useSetup.setState({ finishing: false })
    throw e
  }
  const { storyId, sceneId } = made
  const app = useApp.getState()
  useApp.setState({ settings: await api.getSettings() })
  await app.refreshStories()
  app.selectScene(sceneId, storyId)
  if (build) openWorldBuilder()
  else requestEditorFocus(sceneId)
  useSetup.getState().close()
}

/**
 * The New look's "Not sure yet?": the sample world as a small book on the step, its cover in the harbour's colours,
 * with Explore and the Welcome screen's other ways in.
 */
function SampleWorldCard({ busy, onExplore }: { busy: false | 'create' | 'sample'; onExplore: () => void }): React.JSX.Element {
  return (
    <div className="mt-8 flex gap-5 rounded-[16px] bg-raise p-4 pr-5 shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)]">
      <div aria-hidden className="setup-book relative h-[118px] w-[86px] shrink-0">
        <span className="setup-book-pages" />
        <span className="setup-book-cover">
          <span className="setup-book-title">The Keeper’s Light</span>
          <svg viewBox="0 0 60 44" className="setup-book-art">
            <path d="M0 44 L0 34 C14 30 22 31 30 33 C40 35 48 32 60 30 L60 44 Z" fill="currentColor" opacity="0.5" />
            <path d="M38 32 L42 32 L41 16 L39 16 Z" fill="currentColor" />
            <rect x="37.6" y="13" width="4.8" height="3.4" rx="0.8" fill="var(--sx-lamp, #ffe9b8)" />
            <path d="M40 14.6 L4 8 L4 20 Z" fill="var(--sx-lamp, #ffe9b8)" opacity="0.28" />
          </svg>
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="setup-eyebrow !mb-1">Not sure yet?</p>
        <p className="font-heading text-[17px] font-semibold text-fg">Explore the sample world</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          A small finished world to look round first: a short story set in Gullhaven, with its characters, places and memory filled in.
          Nothing in it costs anything.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button icon={<BookOpen size={15} />} loading={busy === 'sample'} disabled={!!busy} onClick={onExplore}>
            Explore a sample world first
          </Button>
          {WELCOME_ACTIONS.length ? <WelcomeActionButtons actions={FROM_SETUP} /> : null}
        </div>
      </div>
    </div>
  )
}
