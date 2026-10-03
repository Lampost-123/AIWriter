// The first-run setup (milestone 6): shown in place of the Welcome screen on a fresh install. Five short steps,
// each saved as it goes: name the world (it is made there and then), connect an AI service and test it, pick the
// writer model, the basic style, and optionally lay the world out from a summary. Then the world's first scene
// opens with a small guide (FirstSceneGuide.tsx). Back goes to the step before; quitting midway resumes at the
// same step next time (setupStore.ts).

import { BookOpen, Feather, WandSparkles } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { SETUP_STEPS, type SetupStep } from '@shared/contracts/setup'
import { Button, Field, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
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

export function FirstRun(): React.JSX.Element | null {
  const step = useSetup((s) => s.step)
  if (!step) return null
  return (
    <div className="flex h-full justify-center overflow-y-auto bg-bg px-6 pb-16 pt-[7vh]">
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
        {/* A new step fades in; the page never jumps sideways. */}
        <div key={step} className="animate-fade-in">
          {step === 'world' && <WorldStep />}
          {step === 'connect' && <ConnectStep />}
          {step === 'model' && <ModelStep />}
          {step === 'style' && <StyleStepFrame />}
          {step === 'builder' && <BuilderStep />}
        </div>
      </div>
    </div>
  )
}

/** Where Adam is: a calm line of five segments, and the step in words. */
function Progress({ step }: { step: SetupStep }): React.JSX.Element {
  const n = stepNumber(step)
  return (
    <div className="mb-6">
      <div className="flex gap-1.5" aria-hidden>
        {SETUP_STEPS.map((s, i) => (
          <span key={s} className={cn('h-1 flex-1 rounded-full transition-colors duration-200', i < n ? 'bg-accent' : 'bg-line')} />
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
      {made ? null : (
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
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

/**
 * Ends the setup: the world's first story, chapter and scene (made if missing) open, with the guide on that scene.
 * With `build`, the World builder opens over it.
 */
async function finishSetup(build: boolean): Promise<void> {
  const { storyId, sceneId } = await api.finishSetup()
  const app = useApp.getState()
  useApp.setState({ settings: await api.getSettings() })
  await app.refreshStories()
  app.selectScene(sceneId, storyId)
  if (build) openWorldBuilder()
  else requestEditorFocus(sceneId)
  useSetup.getState().close()
}
