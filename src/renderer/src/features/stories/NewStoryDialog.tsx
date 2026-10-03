// The New story dialog (spec, "What Adam sees"): the title and series, then one line such as "Continues
// after Book 2" with Change. For a normal series Adam just clicks Create. Change shows the four answers
// to "What is it?" with the live sentence; warnings sit inline before Create, never in a second dialog.
// Nothing in the world changes until Create, including ending a still-running side story first.
// Opened with useApp().setNewStoryOpen(true) (the story menu, the command palette).
import { ChevronDown, Plus, X } from '@/components/ui/icons'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { StoryPlacement } from '@shared/api'
import type { StillRunning, StorySuggestion } from '@shared/contracts/stories'
import type { ID } from '@shared/types'
import { Button, Dialog, IconButton, Input, Notice, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { usePreview } from './hooks'
import { Knows, PlacementEditor, Warnings, type PendingEnd } from './PlacementEditor'
import { useSeriesList } from './series'
import { createStory } from './storyActions'
import { gapLabel, noGapReason, samePlacement } from './storiesLogic'
// Story recipes: a new story from a recipe, with Adam's own guidance.
import { RecipeChoice, useRecipePick } from '@/features/recipes/RecipeChoice'
import { startFromRecipe } from '@/features/recipes/planStore'
import { sizeForRecipe } from '@/features/recipes/recipeLogic'
import { useRecipes } from '@/features/recipes/recipeStore'

export function NewStoryDialog(): React.JSX.Element | null {
  const open = useApp((s) => s.newStoryOpen)
  const worldId = useApp((s) => s.world?.id ?? null)
  // A fresh form each time it opens.
  return open && worldId ? <NewStoryForm key={worldId} /> : null
}

/**
 * Brings an element into view inside the form's own scroll area, scrolling nothing else. Once the form
 * has scrolled up to the pinned line, that line covers the top of the form, so what comes after it is
 * kept below it.
 */
function reveal(area: HTMLElement | null, pinned: HTMLElement | null, el: Element | null): void {
  if (!area || !el) return
  const a = area.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const p = pinned && pinned.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? pinned.getBoundingClientRect() : null
  const top = (p ? Math.max(a.top, p.bottom) : a.top) + 8
  if (r.top < top) {
    area.scrollTop -= top - r.top
    return
  }
  // Scrolling down brings the pinned line over the top of the form, so the element's top stays clear of it.
  const down = Math.min(r.bottom - a.bottom + 8, r.top - a.top - (p?.height ?? 0) - 8)
  if (down > 0) area.scrollTop += down
}

function NewStoryForm(): React.JSX.Element {
  const id = useId()
  const stories = useApp((s) => s.stories)
  const fromStoryId = useApp((s) => s.storyId)
  const setOpen = useApp((s) => s.setNewStoryOpen)
  const series = useSeriesList()
  const [startSeries] = useState(() => stories.find((s) => s.id === fromStoryId)?.seriesId ?? stories[stories.length - 1]?.seriesId ?? null)

  const [title, setTitle] = useState('')
  const titleTouched = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const [seriesChoice, setSeriesChoice] = useState<string | null>(startSeries)
  const [isNew, setIsNew] = useState(false)
  const [seriesName, setSeriesName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [placement, setPlacementState] = useState<StoryPlacement | null>(null)
  const placementTouched = useRef(false)
  const [suggested, setSuggested] = useState<StorySuggestion | null>(null)
  const [changing, setChanging] = useState(false)
  const [gap, setGap] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // The dialog appears with its suggestion in place (it takes a few milliseconds), or after a moment without it.
  const [ready, setReady] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const pinnedRef = useRef<HTMLDivElement>(null)
  /** The story was made: its first scene takes the keyboard (see createStory). */
  const made = useRef(false)
  const [recipe, setRecipe] = useRecipePick()

  const seriesId = isNew ? null : seriesChoice

  // A world whose stories have no series yet starts in its first one.
  useEffect(() => {
    if (!seriesChoice && !stories.length && series?.length) setSeriesChoice(series[0].id)
  }, [series, seriesChoice, stories.length])

  // The suggested start (and title) for the chosen series, until Adam changes them himself. The stories
  // only change while this is open when one is made, so they aren't followed here.
  const ticket = useRef(0)
  const storiesNow = useRef(stories)
  storiesNow.current = stories
  useEffect(() => {
    const mine = ++ticket.current
    const t = setTimeout(
      () => {
        api
          .suggestStart({ seriesId, newSeries: isNew ? seriesName : undefined, fromStoryId })
          .then((s) => {
            if (mine !== ticket.current) return
            setSuggested(s)
            if (!placementTouched.current) setPlacementState(s.placement)
            if (!titleTouched.current) {
              setTitle(s.title)
              // Typing replaces the suggested title.
              requestAnimationFrame(() => {
                if (document.activeElement === titleRef.current && !titleTouched.current) titleRef.current?.select()
              })
            }
          })
          .catch(() => {
            if (mine !== ticket.current || placementTouched.current) return
            const last = storiesNow.current[storiesNow.current.length - 1]
            const after: StoryPlacement = {
              kind: 'continues',
              startStoryId: last?.id ?? null,
              startAt: 'end',
              startRefId: null,
              endAt: null,
              endRefId: null,
              leadsIntoId: null
            }
            setPlacementState((p) => p ?? after)
          })
          .finally(() => setReady(true))
      },
      // While a new series' name is typed, the suggested title follows after a short pause.
      isNew ? 150 : 0
    )
    return () => clearTimeout(t)
  }, [seriesId, isNew, seriesName, fromStoryId])

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 250)
    return () => clearTimeout(t)
  }, [])

  // "New series" goes straight on to its name, and back to the series list after.
  const toggled = useRef(false)
  useEffect(() => {
    if (!toggled.current) return
    if (isNew) nameRef.current?.focus()
    else document.getElementById(`${id}-series`)?.focus()
  }, [isNew, id])
  const newSeries = (on: boolean): void => {
    toggled.current = true
    setIsNew(on)
    setNameError(null)
  }

  const setPlacement = (p: StoryPlacement): void => {
    placementTouched.current = true
    setPlacementState(p)
  }

  // "End Ash after Ch 1" is held here and done on Create. It belongs to where this story starts, so
  // choosing another start drops it (the button comes back if Ash is still running there).
  const placementKey = placement ? JSON.stringify(placement) : ''
  const [ending, setEnding] = useState<{ key: string; items: PendingEnd[] }>({ key: '', items: [] })
  const pending = ending.key === placementKey ? ending.items : []
  const endFirst = pending.map(({ storyId, endRefId }) => ({ storyId, endRefId }))
  const endBefore = (r: StillRunning): void => {
    if (!r.endFirst) return
    const item: PendingEnd = { storyId: r.storyId, title: r.title, endRefId: r.endFirst.endRefId, chapter: r.endFirst.chapter }
    setEnding({ key: placementKey, items: [...pending.filter((e) => e.storyId !== r.storyId), item] })
  }
  const keepRunning = (storyId: ID): void => setEnding({ key: placementKey, items: pending.filter((e) => e.storyId !== storyId) })

  // The story's own title never changes what it knows, so typing it doesn't work the sentence out again.
  const live = usePreview(placement ? { storyId: null, title: '', seriesId, placement, endFirst } : null)
  // Until the first preview arrives, the suggestion's own preview says the same thing.
  const fromSuggestion =
    !live.current && !pending.length && suggested && placement && samePlacement(placement, suggested.placement) ? suggested.preview : null
  const preview = fromSuggestion ?? live.preview
  const current = live.current || !!fromSuggestion
  const gapFor = placement ? gapLabel(placement, stories) : null
  const blocked = !!(current && preview?.problem)

  // Opening Change brings the line saying what the story is to the top of the form, with what it will
  // know pinned under it, so the four answers and where it starts are in view below them together.
  useLayoutEffect(() => {
    const area = formRef.current
    const pinned = pinnedRef.current
    if (!changing || !area || !pinned) return
    const down = pinned.getBoundingClientRect().top - area.getBoundingClientRect().top
    if (down > 0) area.scrollTop += down
  }, [changing])

  // What the keyboard moves to is brought into view clear of the pinned line, not left under it (a
  // hidden radio button shows its focus on its card). The pinned line itself, and the lists the choices
  // open outside the form, are left as they are.
  const keepFocusInView = (el: Element): void => {
    const area = formRef.current
    if (area?.contains(el) && !pinnedRef.current?.contains(el)) reveal(area, pinnedRef.current, el.closest('label') ?? el)
  }

  // A warning or a problem that appears below the choices is brought into view, so it is seen before Create.
  const warningsRef = useRef<HTMLDivElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const warningKinds = current && preview && !preview.problem ? preview.warnings.map((w) => w.kind).join() : ''
  const problem = blocked && !changing ? (preview?.problem ?? null) : null
  useEffect(() => {
    if (warningKinds) reveal(formRef.current, pinnedRef.current, warningsRef.current)
  }, [warningKinds])
  useEffect(() => {
    if (problem) reveal(formRef.current, pinnedRef.current, problemRef.current)
  }, [problem])
  useEffect(() => {
    if (createError) reveal(formRef.current, pinnedRef.current, errorRef.current)
  }, [createError])

  const submit = async (): Promise<void> => {
    if (busy || !placement) return
    if (isNew && !seriesName.trim()) {
      setNameError('Give the new series a name.')
      nameRef.current?.focus()
      return
    }
    if (blocked) return
    setBusy(true)
    setCreateError(null)
    const error = await createStory(
      {
        title: title.trim() || suggested?.title || 'Untitled story',
        seriesId,
        newSeries: isNew ? seriesName.trim() : undefined,
        placement,
        timeGap: gapFor ? gap.trim() : '',
        ...(endFirst.length ? { endFirst } : {})
      },
      () => {
        made.current = true
        setOpen(false)
      }
    )
    if (error) {
      setBusy(false)
      setCreateError(error)
      return
    }
    // From a recipe: the story takes its style (if Adam left that ticked) and the AI lays it out.
    const storyId = useApp.getState().storyId
    if (recipe.recipeId && storyId) {
      const chapters = useRecipes.getState().list?.find((r) => r.id === recipe.recipeId)?.chapters ?? 0
      void startFromRecipe({ storyId, recipeId: recipe.recipeId, guidance: recipe.guidance.trim(), useStyle: recipe.useStyle, size: sizeForRecipe(chapters) })
    }
  }

  const seriesOptions = (series ?? []).map((s) => ({ value: s.id, label: s.name.trim() || 'Untitled series' }))

  return (
    <Dialog
      open={ready}
      onOpenChange={(o) => !o && setOpen(false)}
      // Closed without making one: the keyboard goes back where Adam was, the page or else the story menu.
      onCloseAutoFocus={(e) => {
        if (made.current) return
        e.preventDefault()
        const { view, sceneId } = useApp.getState()
        if (view.kind === 'write' && sceneId) requestEditorFocus(sceneId)
        else document.querySelector<HTMLElement>('[data-story-menu]')?.focus()
      }}
      title="New story"
      width={620}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy} disabled={blocked || !placement}>
            Create
          </Button>
        </>
      }
    >
      {/* The form scrolls inside the dialog (whose title, padding and buttons take about 122px of its 76vh),
          with the line saying what the story is (and, while Change is open, what it will know) pinned at
          its top, so they and Create stay in view however much Change shows. It is positioned so the
          hidden radio buttons scroll with it. */}
      <form
        ref={formRef}
        id={`${id}-form`}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onFocus={(e) => keepFocusInView(e.target)}
        className="relative -mx-5 -my-1 flex max-h-[calc(76vh-124px)] flex-col gap-3.5 overflow-y-auto px-5 py-1"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-title`} className="text-[12px] font-medium text-muted">
            Title
          </label>
          <Input
            ref={titleRef}
            id={`${id}-title`}
            value={title}
            placeholder="Untitled story"
            onFocus={(e) => !titleTouched.current && e.currentTarget.select()}
            onChange={(e) => {
              titleTouched.current = true
              setTitle(e.target.value)
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={isNew ? `${id}-series-name` : `${id}-series`} className="text-[12px] font-medium text-muted">
            {isNew ? 'New series name' : 'Series'}
          </label>
          <div className="flex items-center gap-2">
            {isNew ? (
              <>
                <Input
                  ref={nameRef}
                  id={`${id}-series-name`}
                  value={seriesName}
                  placeholder="The Long Dark"
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? `${id}-series-error` : undefined}
                  onChange={(e) => {
                    setSeriesName(e.target.value)
                    setNameError(null)
                  }}
                />
                <IconButton type="button" label="Choose an existing series instead" onClick={() => newSeries(false)}>
                  <X size={15} />
                </IconButton>
              </>
            ) : (
              <>
                <Select
                  id={`${id}-series`}
                  value={seriesChoice}
                  options={seriesOptions}
                  allowNone
                  noneLabel="No series"
                  onChange={setSeriesChoice}
                />
                <Button type="button" variant="ghost" icon={<Plus size={14} />} onClick={() => newSeries(true)}>
                  New series
                </Button>
              </>
            )}
          </div>
          {nameError ? (
            <p id={`${id}-series-error`} className="text-[12px] text-danger">
              {nameError}
            </p>
          ) : null}
        </div>

        <RecipeChoice value={recipe} onChange={setRecipe} />

        {/* While Change is open, what the story will know sits under that line, so it stays in view as
            the answers and where the story starts are chosen below. A narrow band under it keeps what
            scrolls beneath it clear of its edge without taking any room. */}
        <div
          ref={pinnedRef}
          className="sticky -top-1 z-10 -mx-5 -mt-1 bg-surface px-5 pt-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-1 after:bg-surface"
        >
          <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
            <div className="flex min-h-[42px] items-center gap-3 px-3 py-1.5">
              <p className="min-w-0 flex-1 text-[13.5px] font-medium text-fg" aria-live="polite">
                {preview?.summary ?? ''}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={changing}
                aria-controls={`${id}-change`}
                onClick={() => setChanging((c) => !c)}
                icon={<ChevronDown size={14} className={cn('transition-transform duration-150', changing && 'rotate-180')} />}
              >
                {changing ? 'Done' : 'Change'}
              </Button>
            </div>
            {changing && placement ? (
              <Knows joined preview={preview} current={current} onEndFirst={endBefore} pendingEnds={pending} onKeepRunning={keepRunning} />
            ) : null}
          </div>
        </div>

        {changing && placement ? (
          <div id={`${id}-change`} className="animate-fade-in">
            <PlacementEditor
              storyId={null}
              seriesId={seriesId}
              value={placement}
              onChange={setPlacement}
              preview={preview}
              current={current}
              knows={false}
            />
          </div>
        ) : null}

        {problem ? (
          <div ref={problemRef}>
            <Notice tone="danger">{problem}</Notice>
          </div>
        ) : null}
        {current && preview && !preview.problem && preview.warnings.length ? (
          <div ref={warningsRef}>
            <Warnings warnings={preview.warnings} onPick={setPlacement} />
          </div>
        ) : null}
        {createError ? (
          <div ref={errorRef}>
            <Notice tone="danger">Couldn’t make this story. {createError}</Notice>
          </div>
        ) : null}

        {/* The time gap, or a line saying why there is none, then the line about new worlds. */}
        <div className="flex flex-col gap-3">
          {gapFor ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-gap`} className="text-[12px] font-medium text-muted">
                {gapFor}
              </label>
              <Input id={`${id}-gap`} value={gap} placeholder="Optional, such as 200 years" onChange={(e) => setGap(e.target.value)} />
              <p className="text-[12px] text-faint">After a long gap, the AI fills in what changed in between.</p>
            </div>
          ) : placement ? (
            <p className="text-[12px] leading-relaxed text-faint">{noGapReason(placement)}</p>
          ) : null}
          <p className="text-[12px] leading-relaxed text-faint">
            A story with nothing in common with this world belongs in a new world. Worlds never read each other, so nothing leaks either
            way.
          </p>
        </div>
      </form>
    </Dialog>
  )
}
