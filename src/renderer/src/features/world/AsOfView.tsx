// An entry as of a point in the story (milestone 3: "Any entry can be viewed as of any scene"):
// read-only, with a slider through the story's scenes kept at the top of the page, what has changed
// by then marked, what has happened so far, its relationships and what it knows. "Back to editing"
// returns to the profile in one click. The last answer stays on screen while the next one loads, so
// sliding never flickers.

import { Pencil } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import type { FirstExists } from '@shared/contracts/entryViews'
import type { Entry, EntryAsOf, ID } from '@shared/types'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { AsOfSlider } from '@/features/views/AsOfSlider'
import { AsSeenIn } from '@/features/views/AsSeenIn'
import { useAsOfStops, useEntryAsOf } from '@/features/views/useAsOf'
import { asOfProfile, asOfRelations, chosenStop, type AsOfValue } from './asOfViewLogic'
import { setAsOfMode, useAsOfMode } from './asOfMode'
import { firstAppearsText } from './firstExistsLogic'
import { QuietError } from './memory/QuietError'
import { relationshipsTitle } from './memory/RelationshipsSection'

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
  const stops = useAsOfStops(story, entry.id)
  const stop = stops ? chosenStop(stops, chosen, sceneId) : null
  const asOf = useEntryAsOf(entry.id, stop?.at ?? null)
  const slow = useDelayed(!asOf.data && !asOf.error, 250)

  const bar = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(autoFocus)
  useLayoutEffect(() => {
    if (!wantFocus.current || !stops) return
    wantFocus.current = false
    const target = bar.current?.querySelector<HTMLElement>('input[type=range]') ?? bar.current?.querySelector<HTMLElement>('[data-back-to-editing]')
    target?.focus()
  }, [stops])

  return (
    <>
      {/* Stays at the top while Adam scrolls, so the slider never moves out from under his hand. */}
      <div ref={bar} className="sticky top-0 z-10 -mx-8 mt-2 border-b border-line bg-bg px-8 pb-3 pt-2.5">
        <div className="flex min-h-[52px] items-end gap-4">
          <AsSeenIn
            value={story}
            onChange={(id) => setAsOfMode({ seenIn: id, at: null })}
            className="w-[170px] shrink-0"
          />
          {stops?.length ? (
            <AsOfSlider stops={stops} value={stop?.at ?? null} onChange={(at) => setAsOfMode({ at })} className="min-w-0 flex-1" />
          ) : (
            <div className="min-w-0 flex-1 self-center text-[12.5px] text-muted">{stops ? 'There are no scenes to see it in yet.' : null}</div>
          )}
          <Button size="sm" icon={<Pencil size={13} />} onClick={onBack} className="mb-0.5" data-back-to-editing>
            Back to editing
          </Button>
        </div>
      </div>

      <div className="min-h-[50vh] pt-5">
        {asOf.error && !asOf.data ? (
          <QuietError what={`${entry.name.trim() || 'it'} at this point`} message={asOf.error} onRetry={asOf.reload} />
        ) : !asOf.data ? (
          slow ? (
            <div className="flex flex-col gap-3" aria-hidden>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null
        ) : (
          <AsOfContent data={asOf.data} entry={entry} others={others} firsts={firsts} onOpen={onOpen} />
        )}
      </div>
    </>
  )
}

const AsOfContent = memo(function AsOfContent({
  data,
  entry,
  others,
  firsts,
  onOpen
}: {
  data: EntryAsOf
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
  const relations = asOfRelations(data.relationships, entry.id, nameOf)

  if (!state || !profile) {
    const first = firstAppearsText(firsts ?? [])
    return (
      <div role="status" className="animate-fade-in rounded-lg border border-dashed border-line-strong px-5 py-8 text-center">
        <p className="text-[15px] font-semibold text-fg">{data.absent || 'Not in the story yet at this point'}</p>
        {first ? <p className="mt-1 text-[13px] text-muted">{first}.</p> : null}
      </div>
    )
  }

  const happened = state.happened
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-muted">
        {profile.changedCount
          ? 'What has changed by this point is marked.'
          : happened.length
            ? 'Nothing written here has changed by this point.'
            : `Nothing has changed yet: ${name} is as you wrote ${entry.kind === 'character' ? 'them' : 'it'}.`}
      </p>

      {profile.summary || profile.description ? (
        <dl className="flex flex-col gap-4">
          {profile.summary ? <Value v={profile.summary} /> : null}
          {profile.description ? <Value v={profile.description} prose /> : null}
        </dl>
      ) : null}

      {profile.groups.map((g) => (
        <section key={g.id}>
          <h3 className="mb-2 text-[13.5px] font-semibold text-fg">{g.label}</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 @lg:grid-cols-2">
            {g.rows.map((r) => (
              <Value key={r.key} v={r} />
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
                  {h.where || 'From the start'}
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
              {data.knows.map((f) => (
                <li key={f.factId}>{f.fact}</li>
              ))}
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

/** One value as of the point: its label, "Changed" when a change has set it by then, and the words. */
function Value({ v, prose = false }: { v: AsOfValue; prose?: boolean }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 flex items-center gap-2 text-[12px] font-medium text-muted">
        {v.label}
        {v.changed ? <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Changed</span> : null}
      </dt>
      <dd className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg', prose && 'font-serif text-[14.5px]')}>{v.value}</dd>
    </div>
  )
}
