// An entry as of a point in the story (milestone 3: "Any entry can be viewed as of any scene"):
// read-only, with a slider through the story's scenes kept at the top of the page, what has changed
// by then marked, what has happened so far, its relationships and what it knows. Each value still as
// written, each relationship and each fact says where it came from (the words, the AI, or Adam).
// "Back to editing" returns to the profile in one click. The last answer stays on screen while the
// next one loads, so sliding never flickers.

import { Pencil } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import type { FirstExists } from '@shared/contracts/entryViews'
import type { ChangeView, Entry, EntryAsOf, ID } from '@shared/types'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { AsOfSlider } from '@/features/views/AsOfSlider'
import { AsSeenIn } from '@/features/views/AsSeenIn'
import { hasOtherKinds } from '@/features/views/asOfLogic'
import { useAsOfStopsState, useEntryAsOf } from '@/features/views/useAsOf'
import {
  asOfHappened,
  asOfLead,
  asOfNote,
  asOfOrigins,
  asOfProfile,
  asOfRelations,
  chosenStop,
  knowsSource,
  type AsOfValue
} from './asOfViewLogic'
import { setAsOfMode, useAsOfMode } from './asOfMode'
import { firstAppearsText } from './firstExistsLogic'
import { QuietError } from './memory/QuietError'
import { relationshipsTitle } from './memory/RelationshipsSection'
import { SourceLine, type LineNote } from './memory/SourceLine'
import { useEntryData } from './memory/useEntryData'
import { allAdams, linksFor, sourceNote } from './memoryLogic'
import { useSceneLabels, type ScenePlace } from './useSceneLabels'

export function EntryAsOfView({
  entry,
  others,
  firsts,
  onBack,
  onOpen,
  autoFocus = false
}: {
  /** The entry as it is on the page (its name and kind). */
  entry: Pick<Entry, 'id' | 'kind' | 'name'>
  others: Entry[]
  /** Where it first appears, for saying so when it isn't there yet. */
  firsts: FirstExists[] | null
  onBack: () => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
  /** Move focus to the slider once it is there (when Adam chose to look as of a scene, not when he opened another entry). */
  autoFocus?: boolean
}): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const stories = useApp((s) => s.stories)
  const chosen = useAsOfMode((s) => s.at)
  const seenIn = useAsOfMode((s) => s.seenIn)
  const story = seenIn && stories.some((s) => s.id === seenIn) ? seenIn : storyId
  // Whether "As seen in" shows (as AsSeenIn decides).
  const picker = hasOtherKinds(stories)
  const { stops, error: stopsError, reload: reloadStops } = useAsOfStopsState(story, entry.id)
  const stop = stops ? chosenStop(stops, chosen, sceneId) : null
  const asOf = useEntryAsOf(entry.id, stop?.at ?? null)
  // Its changes, for who made each relationship and fact shown. The view waits for them the first
  // time (not as the slider moves), so those lines never arrive after the rest and move it.
  const changes = useEntryData(() => api.listChanges(entry.id), `changes:${entry.id}`)
  const ready = !!asOf.data && (!!changes.data || !!changes.error)
  // Placeholders only while a point is loading: with no point (no stops, or they couldn't load) there is nothing to wait for.
  const slow = useDelayed(!!stop && !ready && !asOf.error, 250)

  const bar = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(autoFocus)
  useLayoutEffect(() => {
    if (!wantFocus.current || (!stops && !stopsError)) return
    wantFocus.current = false
    const target =
      bar.current?.querySelector<HTMLElement>('input[type=range]') ?? bar.current?.querySelector<HTMLElement>('[data-back-to-editing]')
    target?.focus()
  }, [stops, stopsError])

  return (
    <>
      {/* Stays at the top while Adam scrolls, so the slider never moves out from under his hand. On a
          narrow page with "As seen in", the slider takes a row of its own under it and "Back to editing"
          sits beside it, so the slider keeps room to read its place and to drag. */}
      <div ref={bar} className="sticky top-0 z-10 -mx-8 mt-2 border-b border-line bg-bg px-8 pb-3 pt-2.5">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
          <AsSeenIn value={story} onChange={(id) => setAsOfMode({ seenIn: id, at: null })} className="w-[170px] shrink-0" />
          <div
            className={cn(
              'flex min-h-[52px] min-w-[min(100%,12rem)] flex-1 items-end',
              picker && '@max-[34rem]:order-last @max-[34rem]:basis-full'
            )}
          >
            {stops?.length ? (
              <AsOfSlider stops={stops} value={stop?.at ?? null} onChange={(at) => setAsOfMode({ at })} className="min-w-0 flex-1" />
            ) : (
              <div className="min-w-0 flex-1 self-center text-[12.5px] text-muted">
                {stopsError && !stops ? (
                  <QuietError what="the scenes to look at" message={stopsError} onRetry={reloadStops} />
                ) : stops ? (
                  'There are no scenes to see it in yet.'
                ) : null}
              </div>
            )}
          </div>
          <Button
            size="sm"
            icon={<Pencil size={13} />}
            onClick={onBack}
            className={cn('mb-0.5 shrink-0', picker && '@max-[34rem]:ml-auto')}
            data-back-to-editing
          >
            Back to editing
          </Button>
        </div>
      </div>

      <div className="min-h-[50vh] pt-5">
        {asOf.error && !asOf.data ? (
          <QuietError what={`${entry.name.trim() || 'it'} at this point`} message={asOf.error} onRetry={asOf.reload} />
        ) : !asOf.data || !ready ? (
          slow ? (
            <div className="flex flex-col gap-3" aria-hidden>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null
        ) : (
          <AsOfContent
            data={asOf.data}
            changes={changes.data ?? NO_CHANGES}
            entry={entry}
            others={others}
            firsts={firsts}
            onOpen={onOpen}
          />
        )}
      </div>
    </>
  )
}

const NO_CHANGES: ChangeView[] = []

const AsOfContent = memo(function AsOfContent({
  data,
  changes,
  entry,
  others,
  firsts,
  onOpen
}: {
  data: EntryAsOf
  /** The entry's changes, as its page lists them (empty when they couldn't load). */
  changes: ChangeView[]
  entry: Pick<Entry, 'id' | 'kind' | 'name'>
  others: Entry[]
  firsts: FirstExists[] | null
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}): React.JSX.Element {
  const state = data.state
  const name = (state?.name ?? entry.name).trim() || 'Unnamed'
  const byId = useMemo(() => new Map(others.map((e) => [e.id, e])), [others])
  const nameOf = (id: ID): string | null => (id === entry.id ? name : byId.get(id)?.name.trim() || (byId.has(id) ? 'Unnamed' : null))
  const profile = useMemo(() => (state ? asOfProfile(state, entry.kind) : null), [state, entry.kind])
  const relations = asOfRelations(data.relationships, entry.id, nameOf, changes)
  // All Adam's writing: the line at the top says he wrote it, so his relationships and facts need no note.
  const adamsEntry = !!state && allAdams(state)
  // Where each value still as written came from; the words only load when some were read from the story.
  const origins = useMemo(() => (state && profile ? asOfOrigins(state, profile) : null), [state, profile])
  const fromText = !!origins && [...origins.values()].includes('text')
  const links = useEntryData(() => api.listEntryLinks(entry.id), `links:${entry.id}`, fromText)
  const places = useSceneLabels(!!links.data?.length || changes.some((c) => c.links.length > 0))
  const noteOf = (key: string): LineNote | null => {
    const origin = origins?.get(key)
    if (!origin) return null
    if (origin !== 'text') return { kind: origin }
    if (!links.data && !links.error) return { kind: 'loading' }
    return sourceNote('text', linksFor(links.data ?? [], key)) ?? { kind: 'story' }
  }

  if (!state || !profile) {
    const first = firstAppearsText(firsts ?? [])
    return (
      <div role="status" className="animate-fade-in rounded-lg border border-dashed border-line-strong px-5 py-8 text-center">
        <p className="text-[15px] font-semibold text-fg">{data.absent || 'Not in the story yet at this point'}</p>
        {first ? <p className="mt-1 text-[13px] text-muted">{first}.</p> : null}
      </div>
    )
  }

  const happened = asOfHappened(state.happened)
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-muted">{asOfLead(profile, happened.length, adamsEntry)}</p>

      {profile.summary || profile.description ? (
        <dl className="flex flex-col gap-4">
          {profile.summary ? <Value v={profile.summary} note={noteOf('summary')} places={places} /> : null}
          {profile.description ? <Value v={profile.description} note={noteOf('description')} places={places} prose /> : null}
        </dl>
      ) : null}

      {profile.groups.map((g) => (
        <section key={g.id}>
          <h3 className="mb-2 text-[13.5px] font-semibold text-fg">{g.label}</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 @lg:grid-cols-2">
            {g.rows.map((r) => (
              <Value key={r.key} v={r} note={noteOf(r.key)} places={places} />
            ))}
          </dl>
        </section>
      ))}

      <section>
        <h3 className="mb-2 text-[13.5px] font-semibold text-fg">What has happened so far</h3>
        {happened.length ? (
          <ol className="flex flex-col gap-1.5">
            {happened.map((h) => (
              <li key={h.changeId} className="flex items-baseline gap-2 text-[13.5px] text-fg">
                <span className="w-[150px] shrink-0 truncate text-[12px] text-faint" title={h.where}>
                  {h.where}
                </span>
                <span className="min-w-0">{h.note}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-muted">Nothing yet at this point.</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[13.5px] font-semibold text-fg">{relationshipsTitle(entry.kind)}</h3>
        {relations.length ? (
          <ul className="flex flex-col gap-2">
            {relations.map((r) => {
              const other = byId.get(r.otherId)
              const note = asOfNote(r.source, adamsEntry)
              return (
                <li key={r.otherId} className="text-[13.5px] text-fg">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {other ? (
                      <button
                        type="button"
                        title={`Open ${other.name.trim() || 'it'}`}
                        onClick={() => onOpen(other)}
                        className="rounded-sm text-left underline-offset-2 hover:text-accent hover:underline"
                      >
                        {r.text}
                      </button>
                    ) : (
                      <span>{r.text}</span>
                    )}
                    {r.where ? <span className="text-[12px] text-faint">since {r.where}</span> : null}
                  </span>
                  {r.feels ? <span className="block text-[12.5px] text-muted">{r.feels}</span> : null}
                  {note ? <SourceLine note={note} places={places} showAdam className="flex" /> : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">None at this point.</p>
        )}
      </section>

      {entry.kind === 'character' ? (
        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold text-fg">Knows at this point</h3>
          {data.knows.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] text-fg marker:text-faint">
              {data.knows.map((f) => {
                const note = asOfNote(knowsSource(entry.id, f.factId, changes), adamsEntry)
                return (
                  <li key={f.factId}>
                    {f.fact}
                    {note ? <SourceLine note={note} places={places} showAdam className="flex" /> : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nothing noted yet.</p>
          )}
        </section>
      ) : null}

      {data.thread ? (
        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold text-fg">At this point</h3>
          <p className="text-[13.5px] text-fg">{data.thread.status === 'resolved' ? 'Resolved' : 'Still open'}</p>
          {data.thread.setUp ? <p className="text-[12.5px] text-muted">Set up in {data.thread.setUp}</p> : null}
          {data.thread.paidOff ? <p className="text-[12.5px] text-muted">Paid off in {data.thread.paidOff}</p> : null}
        </section>
      ) : null}
    </div>
  )
})

/**
 * One value as of the point: its label, then "Changed" when a change has set it by then, or else
 * quietly where it came from (the words, "Drafted by AI", "You wrote this"), and the words. Both sit on
 * the label's line, so the page doesn't move as values change along the slider.
 */
function Value({
  v,
  note,
  places,
  prose = false
}: {
  v: AsOfValue
  note: LineNote | null
  places: Map<ID, ScenePlace> | null
  prose?: boolean
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 flex min-w-0 items-baseline gap-2 text-[12px] font-medium text-muted">
        <span className="shrink-0">{v.label}</span>
        {v.changed ? (
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Changed</span>
        ) : (
          <SourceLine note={note} places={places} showAdam className="font-normal" />
        )}
      </dt>
      <dd className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg', prose && 'font-serif text-[14.5px]')}>
        {v.value}
      </dd>
    </div>
  )
}
