// The Story builder (View 'storyBuilder'; contracts/storyBuilder.ts): the one place a story is built with the AI. Its
// steps, in order: 1. Your idea (the plot, the story's style, a recipe, anything that must or must never happen, your
// own characters and places, and questions); 2. Cast and world (the AI plans every character, place, event, plot
// thread and more; Adam ticks, edits, redoes or talks it over, then it is built in full); 3. Outline (the outline
// helper, planning acts, chapters and scene cards from the idea and the finished codex, talked over and redone the same
// way, kept piece by piece); 4. Done. The steps sit across the top of every step, so any can be visited again.
// Nothing is added to the story or the world without a click.

import { useEffect, useLayoutEffect } from 'react'
import { Check, Feather, ListTree, Sparkles, Users, ArrowLeft, ArrowRight } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { Button, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { helperKey, openHelper, treeOf, useOutlineHelper } from '@/features/outline/helperStore'
import { countNodes, totalOf } from '@/features/outline/tree'
import { PlanHub } from '@/features/planHub/PlanHub'
import { RecipePlan } from '@/features/recipes/RecipePlan'
import { briefOf, builderKey, followRecipe, loadBrief, useBuilders, type Step } from './store'
import { IdeaStep } from './IdeaStep'
import { CodexStep } from './CodexStep'
import { DoneStep } from './DoneStep'
import '@/features/planning/planning.css'

const STEPS: { id: Step; label: string; icon: typeof Feather }[] = [
  { id: 'idea', label: 'Your idea', icon: Feather },
  { id: 'codex', label: 'Cast and world', icon: Users },
  { id: 'outline', label: 'Plan', icon: ListTree },
  { id: 'done', label: 'Done', icon: Check }
]

export function openStoryBuilder(storyId: ID, step?: Step): void {
  const app = useApp.getState()
  // Its Outline step is the Plan hub (2026-10-20), with a way back to the step Adam came from.
  if (step === 'outline') {
    const from = app.view.kind === 'storyBuilder' ? app.view : null
    app.navigate({ kind: 'planHub', storyId, ...(from ? { back: { view: from, label: 'Back to the Story builder' } } : {}) })
    return
  }
  app.navigate({ kind: 'storyBuilder', storyId, ...(step ? { step } : {}) })
}

export function StoryBuilderView({ storyId, step, recipeId }: { storyId: ID; step?: Step; recipeId?: ID }): React.JSX.Element {
  const story = useApp((s) => s.stories.find((st) => st.id === storyId) ?? null)
  const b = useBuilders((s) => s.builders[builderKey(storyId)])
  useLayoutEffect(() => {
    openHelper(storyId)
    // A story planned from a recipe: it follows that recipe (its style went in when it was made).
    void loadBrief(storyId).then(() => {
      if (recipeId && !briefOf(storyId).recipe) followRecipe(storyId, recipeId)
    })
  }, [storyId, recipeId])
  if (!story) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState
          icon={<Sparkles size={20} />}
          title="This story isn’t here any more"
          actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
        >
          It may have been deleted. Stories you delete stay in Settings › Recently deleted for 30 days.
        </EmptyState>
      </div>
    )
  }
  if (!b?.brief) return <div className="h-full" />
  const shown = step ?? whereItStands(storyId)
  // The outline step is the Plan hub (2026-10-20): the one place to plan with AI.
  if (shown === 'outline') return <PlanHub storyId={storyId} back={{ view: { kind: 'storyBuilder', storyId, step: 'codex' }, label: 'Back to the cast and world' }} />
  return <Builder storyId={storyId} title={story.title} shown={shown} />
}

/**
 * A story just made from a recipe (View 'recipePlan'): the recipe's own plan page (premise, chapters and scenes laid out
 * with the recipe's shape), as the Story builder's outline step for that story, with the steps above it. The story
 * follows the recipe from here on, so its cast and world are planned with the recipe's roles too.
 */
export function RecipeStoryPlan({ storyId, recipeId }: { storyId: ID; recipeId: ID }): React.JSX.Element {
  useLayoutEffect(() => {
    void loadBrief(storyId).then(() => {
      if (!briefOf(storyId).recipe) followRecipe(storyId, recipeId)
    })
  }, [storyId, recipeId])
  return (
    <div className="flex h-full flex-col" data-story-builder="recipe">
      <StepBar storyId={storyId} shown="outline" />
      <div className="relative min-h-0 flex-1">
        <RecipePlan storyId={storyId} recipeId={recipeId} />
      </div>
    </div>
  )
}

/** The step a story is at: the first not done yet. */
function whereItStands(storyId: ID): Step {
  const b = useBuilders.getState().builders[builderKey(storyId)]
  const brief = b?.brief
  if (!brief) return 'idea'
  const built = !!brief.built || b?.build?.status === 'complete'
  if (!brief.plot.trim() && !brief.mine.length) return 'idea'
  if (!built) return brief.codex ? 'codex' : 'idea'
  return 'outline'
}

/** The steps, as a row of buttons with how each stands. */
function useSteps(storyId: ID): { subs: Record<Step, string>; done: Record<Step, boolean> } {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])
  const worldId = useApp((s) => s.world?.id)
  const run = useOutlineHelper((s) => s.sessions[helperKey(worldId, storyId)]?.run ?? null)
  const brief = b?.brief
  const tree = run ? treeOf(run) : []
  const kept = run ? totalOf(countNodes(tree, run.decisions, 'kept')) : 0
  const arrived = totalOf(countNodes(tree, {}, 'all'))
  const ticked = (brief?.codex ?? []).filter((it) => it.on).length
  const built = !!brief?.built || b?.build?.status === 'complete'
  const plot = brief?.plot.trim() ?? ''
  return {
    subs: {
      idea: plot ? `${plot.split(/\s+/).length} words${brief?.recipe ? ' · a recipe' : ''}` : 'Your plot, style and must-haves',
      codex: b?.build?.status === 'running' ? 'Building…' : built ? 'Built' : brief?.codex ? `${ticked} planned` : 'Not planned yet',
      outline: run?.status === 'running' ? 'Arriving…' : kept ? `${kept} kept` : arrived ? `${arrived} suggested` : 'Not yet',
      done: kept ? 'Ready to write' : ''
    },
    done: { idea: !!plot || (brief?.mine.length ?? 0) > 0, codex: built, outline: kept > 0, done: false }
  }
}

/** The steps across the top: a compact bar over the outline (and a recipe's plan), the full row elsewhere. */
export function StepBar({ storyId, shown, compact = true }: { storyId: ID; shown: Step; compact?: boolean }): React.JSX.Element {
  const { subs, done } = useSteps(storyId)
  return (
    <nav
      aria-label="Story builder steps"
      className={cn(compact ? 'flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-1.5' : 'mt-5 grid grid-cols-2 gap-2 md:grid-cols-4')}
      data-step-bar
    >
      {compact ? (
        <span className="mr-2 flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} aria-hidden /> Story builder
        </span>
      ) : null}
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const on = s.id === shown
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on ? 'step' : undefined}
            onClick={() => openStoryBuilder(storyId, s.id)}
            data-step={s.id}
            title={subs[s.id] || undefined}
            className={cn(
              'flex items-center text-left transition-colors duration-150',
              compact ? 'shrink-0 gap-1.5 rounded-full px-2.5 py-1 text-[12.5px]' : 'gap-2.5 rounded-xl border px-3 py-2.5',
              compact ? (on ? 'bg-accent/10 font-medium text-fg' : 'text-muted hover:bg-line/50 hover:text-fg') : on ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/40'
            )}
          >
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full border font-semibold',
                compact ? 'h-5 w-5 text-[10.5px]' : 'h-7 w-7 text-[12px]',
                done[s.id] ? 'border-success/40 bg-success-soft text-success' : on ? 'border-accent text-accent' : 'border-line text-faint'
              )}
              aria-hidden
            >
              {done[s.id] ? <Check size={compact ? 11 : 13} /> : <Icon size={compact ? 11 : 13} />}
            </span>
            {compact ? (
              <span>
                {i + 1}. {s.label}
              </span>
            ) : (
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-fg">
                  {i + 1}. {s.label}
                </span>
                <span className="block truncate text-[11.5px] text-faint">{subs[s.id]}</span>
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function Builder({ storyId, title, shown }: { storyId: ID; title: string; shown: Step }): React.JSX.Element {
  useEffect(() => {
    document.querySelector('[data-story-builder] [data-scroll]')?.scrollTo({ top: 0 })
  }, [shown])
  return (
    <div className="flex h-full flex-col" data-story-builder={shown}>
      <div className="h-full overflow-y-auto [scrollbar-gutter:stable]" data-scroll>
        <div className="mx-auto w-full max-w-[1200px] px-8 pb-40 pt-8">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            <Sparkles size={12} aria-hidden /> Story builder
          </p>
          <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">Build “{title.trim() || 'your story'}” with the AI</h1>
          <p className="mt-1.5 max-w-[760px] text-[13.5px] leading-relaxed text-muted">
            Tell it your idea. It plans the whole cast and world and builds every page in your codex, then lays out the acts, chapters and scenes.
            Talk any of it over, or have it redo one part: nothing goes into your story until you say so.
          </p>
          <StepBar storyId={storyId} shown={shown} compact={false} />
          <div className="mt-6">
            {shown === 'idea' ? <IdeaStep storyId={storyId} /> : null}
            {shown === 'codex' ? <CodexStep storyId={storyId} /> : null}
            {shown === 'done' ? <DoneStep storyId={storyId} /> : null}
          </div>
          <StepNav storyId={storyId} shown={shown} className="mt-8 pt-4" />
        </div>
      </div>
    </div>
  )
}

/** Back to the step before and on to the next, at the foot of every step (the outline's too, under its two columns). */
function StepNav({ storyId, shown, className }: { storyId: ID; shown: Step; className?: string }): React.JSX.Element {
  const index = STEPS.findIndex((s) => s.id === shown)
  const go = (s: Step): void => openStoryBuilder(storyId, s)
  return (
    <div className={cn('flex items-center justify-between border-t border-line', className)} data-step-nav>
      {index > 0 ? (
        <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => go(STEPS[index - 1].id)}>
          {STEPS[index - 1].label}
        </Button>
      ) : (
        <span />
      )}
      {index < STEPS.length - 1 ? (
        <Button variant="primary" onClick={() => go(STEPS[index + 1].id)} data-next>
          Next: {STEPS[index + 1].label}
          <ArrowRight size={14} aria-hidden className="ml-1" />
        </Button>
      ) : null}
    </div>
  )
}
