// A new story from a recipe (View 'recipePlan'; spec, "Story recipes"): the AI lays out the new story's premise,
// acts, chapters and scene cards from the recipe and Adam's guidance, and he keeps, changes or discards each one.
// The acts, chapters and scenes are the outline helper's own suggestions (features/outline/Suggestions.tsx), so
// they behave exactly as there; the premise is kept as the story's premise. Nothing is added without a click.
// Owned by the Story recipes part.

import { Check, CookingPot, Sparkles, Square } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react'
import type { OutlineSize } from '@shared/contracts/outline'
import { Button, EmptyState, Notice, Select } from '@/components/ui'
import { useApp } from '@/lib/store'
import { ProblemNotice, WritingStatus } from '@/features/builder/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { checkKept, dismissProblem, helperKey, openHelper, stopOutline, treeOf, useOutlineHelper } from '@/features/outline/helperStore'
import { Suggestions } from '@/features/outline/Suggestions'
import { SIZE_CHOICES, fitSize } from '@/features/outline/size'
import { countLine, countNodes, totalOf, withoutGone } from '@/features/outline/tree'
import { premiseOf, recipeName, sizeForRecipe } from './recipeLogic'
import { discardPremise, editPremise, keepPremise, patchPlan, planKey, suggestPlan, usePlans } from './planStore'
import { listenForRecipes, useRecipes } from './recipeStore'
import { BackButton } from './parts'

export function RecipePlan({ storyId, recipeId }: { storyId: string; recipeId: string }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const plan = usePlans((s) => s.plans[planKey(storyId)] ?? null)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  const story = useApp((s) => s.stories.find((st) => st.id === storyId) ?? null)
  const [opened, setOpened] = useState(false)
  useLayoutEffect(() => {
    openHelper(storyId)
    listenForRecipes()
    setOpened(true)
  }, [storyId])
  if (!opened) return <div className="h-full" />
  if (!story || !plan || !session) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState
          icon={<CookingPot size={20} />}
          title={story ? 'This plan isn’t open any more' : 'This story isn’t here any more'}
          actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
        >
          {story ? 'To plan a story from a recipe, choose the recipe in the New story dialog.' : 'It may have been deleted. Stories you delete stay in Settings › Recently deleted for 30 days.'}
        </EmptyState>
      </div>
    )
  }
  return <Plan storyId={storyId} recipeId={recipeId} storyTitle={story.title} />
}

function Plan({ storyId, recipeId, storyTitle }: { storyId: string; recipeId: string; storyTitle: string }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const s = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])!
  const plan = usePlans((st) => st.plans[planKey(storyId)])!
  const summary = useRecipes((st) => st.list?.find((r) => r.id === recipeId) ?? null)
  const [size, setSize] = useState<OutlineSize>(() => s.run?.size ?? sizeForRecipe(summary?.chapters ?? 0))
  const guidanceId = useId()
  const run = s.run
  const running = run?.status === 'running'
  const ended = !!run && !running
  const shown = useMemo(() => (run && s.gone.length ? { ...run, decisions: withoutGone(run.decisions, s.gone) } : run), [run, s.gone])
  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const arrived = countNodes(tree, {}, 'all')
  const open = shown ? totalOf(countNodes(tree, shown.decisions, 'open')) : 0

  useEffect(() => {
    void checkKept(storyId)
  }, [storyId])

  const suggest = (): void => {
    dismissProblem(storyId)
    void suggestPlan(storyId, size)
  }

  const status = running ? (run.retrying ?? (totalOf(arrived) ? `Laying out the story… ${countLine(arrived)} so far` : 'Laying out the story…')) : null
  const doneLine =
    ended && tree.length
      ? run.status === 'complete'
        ? `Here is the plan: ${countLine(arrived)}. Keep what you like.`
        : `It stopped part way. What had arrived is below: ${countLine(arrived)}.`
      : null

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[720px] px-8 pb-48 pt-10">
        <BackButton to="writing" />
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <CookingPot size={12} aria-hidden />
          New story from a recipe
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">Plan “{storyTitle.trim() || 'the new story'}”</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          The AI lays out a premise, chapters and scene cards with the shape of “{summary ? recipeName(summary) : 'the recipe'}”, told through your
          ideas. Keep, change or discard each one: nothing is added to the story until you keep it.
        </p>

        <label htmlFor={guidanceId} className="mt-5 block text-[12px] font-medium text-muted">
          Your own ideas for it
        </label>
        <AutoTextarea
          id={guidanceId}
          value={plan.guidance}
          minRows={2}
          maxRows={10}
          placeholder="Such as: set it on a space station, and make the mentor the villain."
          className="mt-1 text-[14px]"
          onChange={(e) => patchPlan(storyId, { guidance: e.target.value })}
        />
        <p className="mt-1 text-[12px] text-faint">Where your ideas differ from the recipe, yours win.</p>

        <fieldset className="mt-4">
          <legend className="text-[12px] font-medium text-muted">How much to lay out</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SizeSelect
              label="Acts"
              value={size.acts}
              options={SIZE_CHOICES.acts.map((n) => ({ value: n, label: n === 0 ? 'No acts' : plural(n, 'act') }))}
              onChange={(acts) => setSize((z) => fitSize(z, { acts }))}
            />
            <SizeSelect
              label="Chapters"
              value={size.chapters}
              options={SIZE_CHOICES.chapters.map((n) => ({ value: n, label: plural(n, 'chapter') }))}
              onChange={(chapters) => setSize((z) => fitSize(z, { chapters }))}
            />
            <SizeSelect
              label="Scenes in each chapter"
              value={size.scenes}
              options={SIZE_CHOICES.scenes.map((n) => ({ value: n, label: `${plural(n, 'scene')} in each` }))}
              onChange={(scenes) => setSize((z) => fitSize(z, { scenes }))}
            />
          </div>
        </fieldset>

        <div className="mt-3 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button size="lg" icon={<Square size={11} fill="currentColor" />} onClick={() => stopOutline(storyId)} title="Stop. What has arrived stays, to keep or discard.">
                Stop
              </Button>
              <WritingStatus text={status ?? ''} title={run.retrying ?? undefined} />
            </>
          ) : (
            <Button variant="primary" size="lg" icon={<Sparkles size={15} />} onClick={suggest}>
              {run ? 'Lay it out again' : 'Lay out the story'}
            </Button>
          )}
        </div>
        <div className="mt-1 flex min-h-5 items-center gap-3">
          {doneLine ? (
            <p role="status" className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted animate-fade-in">
              {run?.status === 'complete' ? <Check size={13} className="shrink-0 text-success" aria-hidden /> : null}
              <span className="min-w-0">{doneLine}</span>
            </p>
          ) : null}
        </div>

        {s.problem ? (
          <div className="mt-2">
            <ProblemNotice message={s.problem.message} code={s.problem.code} onRetry={s.run ? undefined : suggest} />
          </div>
        ) : null}
        {ended && !tree.length && run.status !== 'error' ? (
          <div className="mt-2">
            <Notice
              action={
                <Button size="sm" onClick={suggest}>
                  Try again
                </Button>
              }
            >
              {run.text.trim() ? 'The AI’s answer didn’t come as a plan, so there is nothing to keep. Please try again.' : 'Nothing arrived before it stopped.'}
            </Notice>
          </div>
        ) : null}

        {run && plan.premise.taskId === run.taskId ? <PremiseCard storyId={storyId} text={run.text} ended={ended} /> : null}

        {shown && (tree.length || running) ? <Suggestions storyId={storyId} run={shown} tree={tree} open={open} starter={null} /> : null}
      </div>
    </div>
  )
}

/** The suggested premise: Keep (as the story's premise), Edit, Discard. */
function PremiseCard({ storyId, text, ended }: { storyId: string; text: string; ended: boolean }): React.JSX.Element | null {
  const premise = usePlans((st) => st.plans[planKey(storyId)]?.premise)
  const [editing, setEditing] = useState(false)
  const id = useId()
  const arrived = premiseOf(text, ended)
  if (!premise || premise.status === 'discarded' || !arrived.text) return null
  const words = premise.text ?? arrived.text
  const kept = premise.status === 'kept'
  return (
    <section aria-label="Suggested premise" className={kept ? 'mt-5 rounded-xl border border-line bg-surface p-4' : 'mt-5 rounded-xl border border-ai/40 bg-ai-soft p-4'}>
      <div className="flex items-center gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Premise</h2>
        {kept ? (
          <span className="flex items-center gap-1 text-[12px] text-success">
            <Check size={12} /> Kept
          </span>
        ) : null}
      </div>
      {editing ? (
        <AutoTextarea
          id={id}
          aria-label="Premise"
          value={words}
          minRows={2}
          maxRows={10}
          autoFocus
          className="mt-2 font-serif text-[15px]"
          onChange={(e) => editPremise(storyId, e.target.value)}
        />
      ) : (
        <p className="mt-1 font-serif text-[15px] leading-[1.6] text-fg">{words}</p>
      )}
      {!kept ? (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="ai"
            disabled={!arrived.complete}
            onClick={() => {
              setEditing(false)
              void keepPremise(storyId, words.trim())
            }}
          >
            Keep
          </Button>
          <Button size="sm" disabled={!arrived.complete} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" disabled={!arrived.complete} onClick={() => discardPremise(storyId)}>
            Discard
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

function SizeSelect({ label, value, options, onChange }: { label: string; value: number; options: { value: number; label: string }[]; onChange: (n: number) => void }): React.JSX.Element {
  const id = useId()
  return (
    <div className="w-[170px] shrink-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={String(value)} onChange={(v) => v !== null && onChange(Number(v))} options={options.map((o) => ({ value: String(o.value), label: o.label }))} />
    </div>
  )
}
