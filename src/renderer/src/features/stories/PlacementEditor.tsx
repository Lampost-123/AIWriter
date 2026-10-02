// "What is it?": the four answers, where the story starts (and, for a side story, ends), and the live
// sentence saying what it will know. Used by the New story dialog and story settings; the parent keeps
// the value and the preview (usePreview) so both screens show the same sentence and warnings.
import { useId, type ReactNode } from 'react'
import type { StoryPlacement } from '@shared/api'
import type { StillRunning, StoryPreview, StoryRef, StoryWarning } from '@shared/contracts/stories'
import type { ID, Outline, StoryKind } from '@shared/types'
import { Button, Notice, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useStoryOutline } from './hooks'
import {
  endOptions,
  endValue,
  firstBookOf,
  KINDS,
  pointValue,
  startOptions,
  switchKind,
  withEnd,
  withStart,
  withStartStory
} from './storiesLogic'

/** The "Story" choice for starting at the beginning of the world. */
const WORLD = '__world__'

/** A side story the New story dialog will end first when the story is created ("Ash", "Ch 1"). */
export type PendingEnd = StoryRef & { endRefId: ID; chapter: string }

export function PlacementEditor({
  storyId,
  seriesId,
  value,
  onChange,
  preview,
  current,
  onEndFirst,
  pendingEnds,
  onKeepRunning,
  hideLegend,
  knows = true
}: {
  /** The story being changed (it can't start in itself); null for a new story. */
  storyId: ID | null
  seriesId: ID | null
  value: StoryPlacement
  onChange: (p: StoryPlacement) => void
  preview: StoryPreview | null
  /** Whether the preview is for this value yet (the last one stays on screen meanwhile). */
  current: boolean
  onEndFirst?: (r: StillRunning) => void
  /** Side stories that will end first once the story is created, each with a button to keep it running. */
  pendingEnds?: PendingEnd[]
  onKeepRunning?: (storyId: ID) => void
  /** For a page whose heading already asks "What is it?" (it stays for screen readers). */
  hideLegend?: boolean
  /** Whether the live sentence sits below the choices (the New story dialog keeps it above them, in view). */
  knows?: boolean
}): React.JSX.Element {
  const id = useId()
  const stories = useApp((s) => s.stories)
  const others = stories.filter((s) => s.id !== storyId)
  const fallback = others[others.length - 1]?.id ?? null
  const outline = useStoryOutline(value.startStoryId)
  const storyOptions = others.map((s) => ({ value: s.id, label: s.title.trim() || 'Untitled story' }))

  const pickKind = (kind: StoryKind): void => {
    if (kind !== value.kind) onChange(switchKind(value, kind, fallback, firstBookOf(others, seriesId)))
  }
  const start = pointValue(value.startAt, value.startRefId)

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className={cn('mb-2 text-[12px] font-medium text-muted', hideLegend && 'sr-only')}>What is it?</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const on = value.kind === k.kind
            return (
              <label
                key={k.kind}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 transition-[background-color,border-color] duration-150',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                  on ? 'border-accent bg-accent-soft' : 'border-line bg-page hover:border-line-strong'
                )}
              >
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={k.kind}
                  checked={on}
                  onChange={() => pickKind(k.kind)}
                  aria-labelledby={`${id}-${k.kind}`}
                  aria-describedby={`${id}-${k.kind}-help`}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                    on ? 'border-accent' : 'border-line-strong'
                  )}
                >
                  {on ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                </span>
                <span className="min-w-0">
                  <span id={`${id}-${k.kind}`} className={cn('block text-[13px] font-medium', on ? 'text-accent' : 'text-fg')}>
                    {k.label}
                  </span>
                  <span id={`${id}-${k.kind}-help`} className="mt-0.5 block text-[12px] leading-snug text-muted">
                    {k.help}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* One row of choices whatever the answer, so nothing below jumps when it changes. The last choice
          takes the room the others leave, so a long one ("The beginning of the world") isn't cut short. */}
      <div className="grid min-h-[52px] grid-cols-3 gap-2">
        {value.kind === 'prequel' ? (
          <Picker label="Book" id={`${id}-book`} wide>
            <Select
              id={`${id}-book`}
              value={value.startStoryId}
              options={storyOptions}
              placeholder="Choose a book"
              onChange={(v) => v && onChange(withStartStory(value, v))}
            />
          </Picker>
        ) : (
          <>
            <Picker label={value.kind === 'own' ? 'Starts from' : 'Story'} id={`${id}-story`} wide={!value.startStoryId}>
              <Select
                id={`${id}-story`}
                value={value.startStoryId ?? (value.kind === 'side' ? null : WORLD)}
                options={value.kind === 'side' ? storyOptions : [{ value: WORLD, label: 'The beginning of the world' }, ...storyOptions]}
                placeholder="Choose a story"
                onChange={(v) => v && onChange(withStartStory(value, v === WORLD ? null : v))}
              />
            </Picker>
            {value.startStoryId ? (
              <Picker label="Starts" id={`${id}-start`} wide={value.kind !== 'side'}>
                <Select
                  id={`${id}-start`}
                  value={start}
                  options={startChoices(outline, value.kind, start)}
                  onChange={(v) => v && onChange(withStart(value, v, outline))}
                />
              </Picker>
            ) : null}
            {value.kind === 'side' && value.startStoryId ? (
              <Picker label="Ends" id={`${id}-end`}>
                <Select
                  id={`${id}-end`}
                  value={endValue(value, outline)}
                  options={endOptions(outline, start)}
                  onChange={(v) => v && onChange(withEnd(value, v))}
                />
              </Picker>
            ) : null}
          </>
        )}
      </div>

      {knows ? (
        <Knows preview={preview} current={current} onEndFirst={onEndFirst} pendingEnds={pendingEnds} onKeepRunning={onKeepRunning} />
      ) : null}
    </div>
  )
}

/**
 * The start choices, keeping the current one listed: while the story's chapters load, and for a side
 * story that starts at its book's end (it took over the start of a deleted story that continued there).
 */
function startChoices(outline: Outline | null, kind: StoryKind, start: string): { value: string; label: string }[] {
  const options = startOptions(outline, kind)
  if (!options.some((o) => o.value === start)) {
    options.push({ value: start, label: start === 'end' ? 'After its end' : outline ? 'Where it was' : 'Loading…' })
  }
  return options
}

function Picker({ label, id, wide, children }: { label: string; id: string; wide?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', wide && 'col-span-2')}>
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * The live sentence: what the story will know, or why it can't be saved. The last sentence stays
 * (a little faded) while the next one is worked out, and the box keeps its height. Below it, a button
 * to end first each side story still running here, and for the New story dialog, the ones it will end.
 * `joined`: it is the lower half of a box (the New story dialog's line saying what the story is).
 */
export function Knows({
  preview,
  current,
  onEndFirst,
  pendingEnds = [],
  onKeepRunning,
  joined
}: {
  preview: StoryPreview | null
  current: boolean
  onEndFirst?: (r: StillRunning) => void
  pendingEnds?: PendingEnd[]
  onKeepRunning?: (storyId: ID) => void
  joined?: boolean
}): React.JSX.Element {
  const ends = preview && !preview.problem ? preview.stillRunning.filter((r) => r.endFirst) : []
  return (
    <div
      className={cn(
        'min-h-[64px] px-3 py-2.5 text-[13px] leading-relaxed transition-opacity duration-150',
        joined ? 'border-t' : 'rounded-lg border',
        preview?.problem ? 'border-danger/30 bg-danger-soft' : 'border-line bg-surface-2',
        !current && preview && 'opacity-70'
      )}
    >
      <p aria-live="polite" className="text-fg">
        {preview ? (preview.problem ?? preview.knows) : <span className="text-faint">Working out what this story will know…</span>}
      </p>
      {pendingEnds.length && onKeepRunning && !preview?.problem
        ? pendingEnds.map((e) => (
            <p key={e.storyId} className="mt-1.5 flex flex-wrap items-center gap-x-2 text-muted">
              <span>
                Creating this story also ends {e.title} after {e.chapter}.
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => onKeepRunning(e.storyId)}>
                Keep {e.title} running
              </Button>
            </p>
          ))
        : null}
      {ends.length && onEndFirst ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {ends.map((r) => (
            <Button key={r.storyId} type="button" size="sm" onClick={() => onEndFirst(r)}>
              {r.endFirst!.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Warnings about choices that would quietly lose history, each with its likely alternatives. */
export function Warnings({
  warnings,
  onPick
}: {
  warnings: StoryWarning[]
  onPick: (p: StoryPlacement) => void
}): React.JSX.Element | null {
  if (!warnings.length) return null
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((w) => (
        <Notice key={w.kind}>
          <p>{w.message}</p>
          {w.options.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {w.options.map((o) => (
                <Button key={o.label} type="button" size="sm" onClick={() => onPick(o.placement)}>
                  {o.label}
                </Button>
              ))}
            </div>
          ) : null}
        </Notice>
      ))}
    </div>
  )
}
