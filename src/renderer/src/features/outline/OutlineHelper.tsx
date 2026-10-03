// The outline helper (View 'outline'): from a premise, the AI suggests acts, chapters and scene cards;
// Adam keeps, changes or discards each one, and nothing is added to the story without a click. It
// streams: suggestions appear in order as they arrive, and Stop keeps what has come. What Adam kept
// goes after what the story has, with each scene's card filled, and shows in the binder at once.
// The suggestions and a request still running are kept in helperStore, so leaving the page loses neither.
import { Check, ListTree, Sparkles, Square } from '@/components/ui/icons'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OutlineSize } from '@shared/contracts/outline'
import { emptySceneCard } from '@shared/defaults'
import type { Act, Chapter, Outline, Story } from '@shared/types'
import { Button, EmptyState, Kbd, Notice, Select } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { ProblemNotice, WritingStatus } from '@/features/builder/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import {
  checkBlank,
  checkKept,
  dismissProblem,
  helperKey,
  openHelper,
  setHelperSize,
  stopOutline,
  suggestOutline,
  treeOf,
  useOutlineHelper,
  type HelperRun,
  type HelperSession
} from './helperStore'
import { cardIsEmpty } from './ideasLogic'
import { SIZE_CHOICES, defaultSize, fitSize } from './size'
import { Suggestions } from './Suggestions'
import { countLine, countNodes, totalOf, withoutGone } from './tree'

export function OutlineHelper({ storyId }: { storyId: string }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  const story = useApp((s) => s.stories.find((st) => st.id === storyId) ?? null)
  const [opened, setOpened] = useState(false)
  // Once each time the page opens, before anything is drawn, so the first frame is the right one. Whether
  // the story has anything planned yet is asked again (openOutlineHelper asks before the page opens).
  useLayoutEffect(() => {
    openHelper(storyId)
    void checkBlank(storyId)
    setOpened(true)
  }, [storyId])
  if (!opened || !session || session.blank === null) return <div className="h-full" />
  if (!story) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState
          icon={<ListTree size={20} />}
          title="This story isn't here any more"
          actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
        >
          It may have been deleted. Stories you delete stay in Settings › Recently deleted for 30 days.
        </EmptyState>
      </div>
    )
  }
  return <Helper story={story} s={session} />
}

function Helper({ story, s }: { story: Story; s: HelperSession }): React.JSX.Element {
  const { outline } = useOutline()
  const shape = outline?.story.id === story.id ? outline : null
  const acts: Act[] = shape?.acts ?? []
  const chapterCount = shape?.chapters.length ?? 0
  // Nothing planned or written yet (perhaps only the empty "Chapter 1" a new story starts with): plan it
  // all from the premise. The main process says, by the rule it uses for what the AI is told.
  const fresh = s.blank === true
  const size = s.size ?? defaultSize(fresh ? 0 : chapterCount, acts.length)
  const run = s.run
  // As the page shows it: anything kept but deleted from the story since waits for a decision again.
  const shown = useMemo(() => (run && s.gone.length ? { ...run, decisions: withoutGone(run.decisions, s.gone) } : run), [run, s.gone])
  const running = run?.status === 'running'
  const premiseBox = useRef<HTMLTextAreaElement>(null)

  // What was kept is looked for again each time the page opens (and whenever the binder changes, see helperStore).
  useEffect(() => {
    void checkKept(story.id)
  }, [story.id])

  // The premise is the story's own (as in its settings): changes here are saved to the story.
  const [premise, setPremise] = useState(story.premise)
  const autosave = useAutosave<string>(
    async (p) => {
      await api.updateStory(story.id, { premise: p })
      await useApp.getState().refreshStories()
    },
    { what: 'the premise' }
  )
  const changePremise = (value: string): void => {
    setPremise(value)
    autosave.schedule(value)
    if (s.problem && (!s.run || s.problem.code === 'no-premise')) dismissProblem(story.id)
  }

  const suggest = useCallback(() => {
    if (!premise.trim()) premiseBox.current?.focus()
    void suggestOutline(story.id, premise, size)
  }, [story.id, premise, size])

  const changeSize = (patch: Partial<OutlineSize>): void => setHelperSize(story.id, fitSize(size, patch))

  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const starter = useStarter(shape, shown)
  const arrived = countNodes(tree, {}, 'all')
  const open = shown ? totalOf(countNodes(tree, shown.decisions, 'open')) : 0
  const ended = !!run && !running
  const nothingRead = ended && tree.length === 0
  const scenes = size.chapters * size.scenes

  const status = running
    ? (run.retrying ?? (totalOf(arrived) ? `Suggesting… ${countLine(arrived)} so far` : 'Suggesting an outline…'))
    : null
  const doneLine =
    ended && !nothingRead
      ? run.status === 'complete'
        ? `Here is the outline: ${countLine(arrived)}. Keep what you like.`
        : run.status === 'stopped'
          ? `Stopped. What had arrived is below: ${countLine(arrived)}.`
          : `It stopped part way. What had arrived is below: ${countLine(arrived)}.`
      : null

  const whatTheAISaw = run?.generationId
    ? () =>
        useApp.getState().navigate({
          kind: 'generation',
          generationId: run.generationId!,
          back: { view: { kind: 'outline', storyId: story.id }, label: 'Back to the outline helper', what: 'this outline' }
        })
    : null

  const lastAct = acts[acts.length - 1]
  const where =
    size.acts === 0
      ? lastAct
        ? `The chapters go in the story’s last act, “${lastAct.title || 'Untitled act'}”.`
        : chapterCount && !fresh
          ? `Just chapters, after the story’s ${chapterCount === 1 ? 'chapter' : `${chapterCount} chapters`}.`
          : 'Just chapters, with no acts.'
      : acts.length
        ? 'New acts go after the story’s acts.'
        : chapterCount && !fresh
          ? `New acts go after the story’s ${chapterCount === 1 ? 'chapter' : `${chapterCount} chapters`}.`
          : null

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      {/* Room at the foot, so the end of the page scrolls clear of the Undo toasts in the corner. */}
      <div className="mx-auto w-full max-w-[720px] px-8 pb-48 pt-10">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} className="text-ai" aria-hidden />
          Outline helper
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">
          {fresh ? 'Plan the story from its premise' : 'Plan what comes next'}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          AI Write suggests acts, chapters and scene cards for {story.title.trim() ? `“${story.title.trim()}”` : 'this story'}
          {fresh ? '' : ', carrying on from what it has so far'}. Keep, change or discard each one: nothing is added to the story until you
          keep it.
        </p>

        <div className="mt-5 flex items-end justify-between gap-2">
          <label htmlFor="outline-premise" className="block text-[12px] font-medium text-muted">
            Premise
          </label>
          <SaveNote status={autosave.status} error={autosave.error} />
        </div>
        <AutoTextarea
          ref={premiseBox}
          id="outline-premise"
          value={premise}
          minRows={3}
          maxRows={12}
          placeholder="For example: a ferryman who owes the Duke money is paid to smuggle the heir out of Varn."
          className="mt-1 font-serif text-[15px] leading-[1.6] placeholder:font-sans placeholder:text-[13.5px]"
          onChange={(e) => changePremise(e.target.value)}
          onBlur={() => void autosave.flush()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (!running) suggest()
            }
          }}
        />
        <p className="mt-1 text-[12px] text-faint">
          What the story is about, in a few sentences. It is the story’s premise, so changes here are saved to it.
        </p>

        <fieldset className="mt-5">
          <legend className="text-[12px] font-medium text-muted">How much to suggest</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SizeSelect
              label="Acts"
              className="w-[150px]"
              value={size.acts}
              options={SIZE_CHOICES.acts.map((n) => ({
                value: n,
                label: n === 0 ? (acts.length ? 'No new acts' : 'No acts') : plural(n, 'act')
              }))}
              onChange={(acts) => changeSize({ acts })}
            />
            <SizeSelect
              label="Chapters"
              className="w-[140px]"
              value={size.chapters}
              options={SIZE_CHOICES.chapters.map((n) => ({ value: n, label: plural(n, 'chapter') }))}
              onChange={(chapters) => changeSize({ chapters })}
            />
            <SizeSelect
              label="Scenes in each chapter"
              className="w-[180px]"
              value={size.scenes}
              options={SIZE_CHOICES.scenes.map((n) => ({ value: n, label: `${plural(n, 'scene')} in each` }))}
              onChange={(scenes) => changeSize({ scenes })}
            />
            <span className="ml-1 text-[12.5px] tabular-nums text-muted">About {plural(scenes, 'scene')}.</span>
          </div>
          <p className="mt-1.5 min-h-[18px] text-[12px] text-faint">{where}</p>
        </fieldset>

        <div className="mt-3 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button
                size="lg"
                icon={<Square size={11} fill="currentColor" />}
                onClick={() => stopOutline(story.id)}
                title="Stop. What has arrived stays, to keep or discard."
              >
                Stop
              </Button>
              <WritingStatus text={status ?? ''} title={run.retrying ?? undefined} />
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" icon={<Sparkles size={15} />} onClick={suggest}>
                {run ? 'Suggest again' : 'Suggest an outline'}
              </Button>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] text-faint" title={`Press ${modKey()}+Enter in the premise to suggest`}>
                <Kbd>{modKey()}</Kbd>+<Kbd>Enter</Kbd>
              </span>
            </>
          )}
        </div>

        <div className="mt-1 flex min-h-5 items-center gap-3">
          {doneLine ? (
            <p role="status" className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted animate-fade-in">
              {run?.status === 'complete' ? <Check size={13} className="shrink-0 text-success" aria-hidden /> : null}
              <span className="min-w-0">{doneLine}</span>
            </p>
          ) : null}
          {whatTheAISaw && (ended || running) ? (
            <button
              type="button"
              onClick={whatTheAISaw}
              className="ml-auto shrink-0 rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              What the AI saw
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 empty:hidden">
          {s.problem ? (
            <div className="mt-2">
              {s.problem.code === 'no-premise' ? (
                // Nothing went wrong: the premise box just needs a word or two first.
                <Notice>{s.problem.message}</Notice>
              ) : (
                <ProblemNotice message={s.problem.message} code={s.problem.code} onRetry={s.run ? undefined : suggest} />
              )}
            </div>
          ) : null}
          {ended && run.cutOff && !nothingRead ? (
            <div className="mt-2">
              <Notice>
                The answer reached its length limit, so the outline stops early. Keep what is here, or ask for fewer chapters at a time.
              </Notice>
            </div>
          ) : null}
          {nothingRead && run.status !== 'error' ? (
            <div className="mt-2">
              <Notice
                action={
                  <Button size="sm" onClick={suggest}>
                    Try again
                  </Button>
                }
              >
                {run.text.trim()
                  ? 'The AI’s answer didn’t come as an outline, so there is nothing to keep. Please try again.'
                  : 'Nothing arrived before it stopped, so there is nothing to keep.'}
              </Notice>
            </div>
          ) : null}
        </div>

        {shown && (tree.length || running) ? (
          <Suggestions storyId={story.id} run={shown} tree={tree} open={open} starter={starter} />
        ) : null}
      </div>
    </div>
  )
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

/** A title a chapter or scene was given when it was made ("Chapter 1", "Scene 1"). */
const PLAIN_TITLE = /^\s*(chapter|scene)\s*\d*\s*$/i

/**
 * After keeping, the story may still start with the empty "Chapter 1" (and its empty scene) it was made
 * with, ahead of what Adam kept: the page offers to remove it (with Undo, as for any chapter).
 */
function useStarter(shape: Outline | null, run: HelperRun | null): Chapter | null {
  const kept = useMemo(
    () => new Set(Object.values(run?.decisions ?? {}).flatMap((d) => (d.status === 'kept' ? [d.id] : []))),
    [run?.decisions]
  )
  const first = shape?.chapters[0]
  const scenes = first && shape ? shape.scenes.filter((sc) => sc.chapterId === first.id) : []
  const candidate =
    !!first &&
    !!shape &&
    !first.actId &&
    PLAIN_TITLE.test(first.title) &&
    !first.goal.trim() &&
    !kept.has(first.id) &&
    shape.chapters.some((c) => kept.has(c.id)) &&
    scenes.every((sc) => sc.wordCount === 0 && PLAIN_TITLE.test(sc.title))
  const sceneKey = candidate ? scenes.map((sc) => sc.id).join(',') : ''
  // Only when its scenes' cards are empty too: nothing of Adam's goes with it.
  const [empty, setEmpty] = useState<{ key: string; empty: boolean } | null>(null)
  useEffect(() => {
    if (!sceneKey && !candidate) return
    let live = true
    const ids = sceneKey ? sceneKey.split(',') : []
    Promise.all(ids.map((id) => api.getScene(id)))
      .then((list) => live && setEmpty({ key: sceneKey, empty: list.every((sc) => cardIsEmpty({ ...emptySceneCard(), ...sc.card })) }))
      .catch(() => live && setEmpty({ key: sceneKey, empty: false }))
    return () => {
      live = false
    }
  }, [sceneKey, candidate])
  return candidate && first && empty?.key === sceneKey && empty.empty ? first : null
}

function SizeSelect({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string
  value: number
  options: { value: number; label: string }[]
  onChange: (n: number) => void
  className?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={cn('shrink-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={String(value)}
        onChange={(v) => v !== null && onChange(Number(v))}
        options={options.map((o) => ({ value: String(o.value), label: o.label }))}
      />
    </div>
  )
}
