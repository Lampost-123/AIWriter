// The New story dialog (spec, "What Adam sees"): the title and series, then one line such as "Continues
// after Book 2" with Change. For a normal series Adam just clicks Create. Change shows the four answers
// to "What is it?" with the live sentence; warnings sit inline before Create, never in a second dialog.
// Opened with useApp().setNewStoryOpen(true) (the story menu, the command palette).
import { ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { StoryPlacement } from '@shared/api'
import type { StorySuggestion } from '@shared/contracts/stories'
import { Button, Dialog, IconButton, Input, Notice, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { usePreview } from './hooks'
import { PlacementEditor, Warnings } from './PlacementEditor'
import { useSeriesList } from './series'
import { createStory, endFirst } from './storyActions'
import { gapLabel, samePlacement } from './storiesLogic'

export function NewStoryDialog(): React.JSX.Element | null {
  const open = useApp((s) => s.newStoryOpen)
  const worldId = useApp((s) => s.world?.id ?? null)
  // A fresh form each time it opens.
  return open && worldId ? <NewStoryForm key={worldId} /> : null
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
  // The dialog appears with its suggestion in place (it takes a few milliseconds), or after a moment without it.
  const [ready, setReady] = useState(false)

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
            setPlacementState(
              (p) => p ?? { kind: 'continues', startStoryId: last?.id ?? null, startAt: 'end', startRefId: null, endAt: null, endRefId: null, leadsIntoId: null }
            )
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

  // The story's own title never changes what it knows, so typing it doesn't work the sentence out again.
  const live = usePreview(placement ? { storyId: null, title: '', seriesId, placement } : null)
  // Until the first preview arrives, the suggestion's own preview says the same thing.
  const fromSuggestion = !live.current && suggested && placement && samePlacement(placement, suggested.placement) ? suggested.preview : null
  const preview = fromSuggestion ?? live.preview
  const current = live.current || !!fromSuggestion
  const gapFor = placement ? gapLabel(placement, stories) : null
  const blocked = !!(current && preview?.problem)

  // A warning that appears below the choices is brought into view, so it is seen before Create.
  const warningsRef = useRef<HTMLDivElement>(null)
  const warningKinds = current && preview && !preview.problem ? preview.warnings.map((w) => w.kind).join() : ''
  useEffect(() => {
    if (warningKinds) warningsRef.current?.scrollIntoView({ block: 'nearest' })
  }, [warningKinds])

  const submit = async (): Promise<void> => {
    if (busy || !placement) return
    if (isNew && !seriesName.trim()) {
      setNameError('Give the new series a name.')
      nameRef.current?.focus()
      return
    }
    if (blocked) return
    setBusy(true)
    const ok = await createStory(
      {
        title: title.trim() || suggested?.title || 'Untitled story',
        seriesId,
        newSeries: isNew ? seriesName.trim() : undefined,
        placement,
        timeGap: gapFor ? gap.trim() : ''
      },
      () => setOpen(false)
    )
    if (!ok) setBusy(false)
  }

  const seriesOptions = (series ?? []).map((s) => ({ value: s.id, label: s.name.trim() || 'Untitled series' }))

  return (
    <Dialog
      open={ready}
      onOpenChange={(o) => !o && setOpen(false)}
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
      <form
        id={`${id}-form`}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-4"
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
                <Select id={`${id}-series`} value={seriesChoice} options={seriesOptions} allowNone noneLabel="No series" onChange={setSeriesChoice} />
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

        <div className="flex min-h-[44px] items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
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
          <div id={`${id}-change`} className="animate-fade-in">
            <PlacementEditor
              storyId={null}
              seriesId={seriesId}
              value={placement}
              onChange={setPlacement}
              preview={preview}
              current={current}
              onEndFirst={(r) => r.endFirst && void endFirst(r.storyId, r.endFirst.endRefId, r.endFirst.label)}
            />
          </div>
        ) : null}

        {blocked && !changing ? <Notice tone="danger">{preview?.problem}</Notice> : null}
        {current && preview && !preview.problem && preview.warnings.length ? (
          <div ref={warningsRef}>
            <Warnings warnings={preview.warnings} onPick={setPlacement} />
          </div>
        ) : null}

        {/* Kept in place (hidden) when there is nothing to come after, so the dialog doesn't change height. */}
        <div className={cn('flex flex-col gap-1', !gapFor && 'invisible')} aria-hidden={!gapFor}>
          <label htmlFor={`${id}-gap`} className="text-[12px] font-medium text-muted">
            {gapFor ?? 'Time since the previous story'}
          </label>
          <Input
            id={`${id}-gap`}
            value={gap}
            disabled={!gapFor}
            placeholder="Optional, such as 200 years"
            onChange={(e) => setGap(e.target.value)}
          />
          <p className="text-[12px] text-faint">After a long gap, the AI fills in what changed in between.</p>
        </div>

        <p className="text-[12px] leading-relaxed text-faint">
          A story with nothing in common with this world belongs in a new world. Worlds never read each other, so nothing leaks either way.
        </p>
      </form>
    </Dialog>
  )
}
