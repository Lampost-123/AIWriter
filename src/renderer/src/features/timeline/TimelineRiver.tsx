// The New look's timeline, "the river" (UI overhaul; the desk and the panels): the story's scenes and events along the
// world's time, as cards on a river that fills the page, with a lane under them for each character (or plot thread).
// Laid out by day (spaced by the time between scenes where their When can be read) or chapter by chapter in reading
// order; flashbacks are marked. Classic keeps its table (TimelineView.tsx).
import './timeline.css'
import { useCallback, useMemo, useState } from 'react'
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import { CalendarRange, Plus, Target } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { Segmented } from '@/features/generate/parts'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { openSceneTab } from '@/layout/areaLinks'
import { useLanes } from './laneStore'
import { laneChoices, shownLanes, type LaneMode } from './timelineLogic'
import { byFirstAppearance, chapterCast, toldOrder, type Zoom } from './riverLogic'
import { RiverArt } from './RiverArt'
import { RiverBody, type RiverActions } from './RiverBody'
import { ClashList, FilterPicker, LanePicker } from './RiverControls'
import { StoryFilter, useViewStory, useWorldView, ViewError, ViewLoading } from './viewParts'

/** Lanes shown before Adam picks his own: the busiest dozen (the river has room for them). */
const RIVER_LANES = 12

const loadTimeline = (storyId: ID): Promise<Timeline> => api.getTimeline(storyId)

const worldKey = (mode: LaneMode): string => `${useApp.getState().world?.id ?? ''}:${mode}`

/** What the river's actions do: into a scene, an entry's page (the desk's dossier), a scene's card. */
const actions: RiverActions = {
  openPoint: (p: TimelinePoint) => {
    const app = useApp.getState()
    if (p.kind === 'scene' && p.storyId) app.selectScene(p.id, p.storyId)
    else app.navigate({ kind: 'entries', entryKind: 'event', entryId: p.id, back: 'timeline' })
  },
  openEntry: (e: TimelineEntry) => useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id, back: 'timeline' }),
  editCard: (p: TimelinePoint) => {
    if (p.kind !== 'scene' || !p.storyId) return
    useApp.getState().selectScene(p.id, p.storyId)
    openSceneTab('card')
  }
}

/** The sentence under the title: how much the river holds. */
function summary(t: Timeline): string {
  const scenes = t.points.filter((p) => p.kind === 'scene').length
  const events = t.points.length - scenes
  const days = new Set(t.points.map((p) => p.day).filter(Boolean)).size
  const flash = toldOrder(t.points).filter((x) => x === 'flashback').length
  const bits = [
    `${scenes} ${scenes === 1 ? 'scene' : 'scenes'}`,
    events ? `${events} ${events === 1 ? 'event' : 'events'}` : '',
    days ? `over ${days} ${days === 1 ? 'day' : 'days'}` : '',
    flash ? `${flash} ${flash === 1 ? 'flashback' : 'flashbacks'}` : ''
  ].filter(Boolean)
  return `${bits.join(' · ')}, in the order they happen in your world.`
}

export function TimelineRiver(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const { data, error, retry } = useWorldView(storyId, loadTimeline)
  const mode = useLanes((s) => s.mode)
  const setMode = useLanes((s) => s.setMode)
  const zoom = useLanes((s) => s.zoom)
  const setZoom = useLanes((s) => s.setZoom)
  const choose = useLanes((s) => s.choose)
  const chosen = useLanes((s) => s.chosen[worldKey(mode)])
  const here = useApp((s) => s.sceneId)
  const motifs = useEntryMotifs()
  const [filter, setFilter] = useState<Set<ID>>(() => new Set())
  const [jump, setJump] = useState(0)
  const [clash, setClash] = useState<{ c: number; rev: number } | null>(null)
  const dated = !!data?.points.some((p) => p.dated)
  // Which lanes: Adam's pick (in the order each first comes along the river, so they step down from the top left), or
  // until he picks, the main cast of the chapter in the middle of the screen, changing as he scrolls to another chapter.
  // Plot threads, until picked: the busiest dozen.
  const [inView, setInView] = useState<ID | null>(null)
  const lanes = useMemo(() => {
    if (!data) return []
    if (!chosen && mode === 'characters') {
      const byId = new Map(data.entries.map((e) => [e.id, e]))
      const cast = chapterCast(data.points, inView ?? data.points.find((p) => p.chapterId)?.chapterId ?? null)
        .slice(0, RIVER_LANES)
        .flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []))
      if (cast.length) return cast
    }
    return byFirstAppearance(data, shownLanes(data, mode, chosen, RIVER_LANES), mode, zoom)
  }, [data, mode, chosen, zoom, inView])
  const following = !chosen && mode === 'characters'
  // Each lane keeps its ink however the lanes change: by its place among everyone on the timeline.
  const inks = useMemo(
    () => new Map((data ? laneChoices(data, mode) : []).map((c, k) => [c.entry.id, `var(--tl-ink-${k % 8})`])),
    [data, mode]
  )
  const hereOn = !!data && !!here && data.points.some((p) => p.id === here)
  const onChoose = useCallback((ids: ID[] | null) => choose(worldKey(mode), ids), [choose, mode])

  return (
    <div className="tl flex h-full min-h-0 flex-col" data-timeline>
      <header className="tl-top">
        <div className="tl-top-title">
          <h1 className="tl-h1">Timeline</h1>
          <p className="tl-sub">{data && dated ? summary(data) : 'Scenes and events in the order they happen in your world.'}</p>
        </div>
        <div className="tl-tools">
          <StoryFilter value={storyId} onChange={setStoryId} />
          {data && dated ? (
            <>
              <Segmented<LaneMode>
                label="Lanes for"
                value={mode}
                onChange={setMode}
                className="whitespace-nowrap"
                options={[
                  { value: 'characters', label: 'Characters' },
                  { value: 'threads', label: 'Plot threads' }
                ]}
              />
              <ClashList timeline={data} onShow={(c) => setClash((was) => ({ c, rev: (was?.rev ?? 0) + 1 }))} />
              <LanePicker
                timeline={data}
                mode={mode}
                shown={lanes.map((l) => l.id)}
                following={following}
                motifs={motifs}
                inks={inks}
                onChoose={onChoose}
              />
              <FilterPicker timeline={data} picked={filter} motifs={motifs} onChange={setFilter} />
              <Segmented<Zoom>
                label="Lay out"
                value={zoom}
                onChange={setZoom}
                className="whitespace-nowrap"
                options={[
                  { value: 'day', label: 'By day' },
                  { value: 'chapter', label: 'By chapter' }
                ]}
              />
              <Button
                icon={<Target size={15} />}
                disabled={!hereOn}
                onClick={() => setJump((n) => n + 1)}
                title={hereOn ? 'Show the scene you’re writing' : 'The scene you’re writing isn’t on this timeline'}
              >
                Jump to now
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {data ? (
        dated ? (
          <RiverBody
            key={`${data.storyId}:${mode}`}
            timeline={data}
            mode={mode}
            zoom={zoom}
            lanes={lanes}
            inks={inks}
            onChapterInView={following ? setInView : undefined}
            filter={filter}
            here={here}
            motifs={motifs}
            jump={jump}
            clash={clash}
            actions={actions}
          />
        ) : (
          <NoDates timeline={data} />
        )
      ) : error ? (
        <ViewError what="The timeline" error={error} onRetry={retry} />
      ) : !storyId ? (
        <div className="tl-empty">
          <RiverArt className="tl-empty-art" />
          <h2 className="tl-empty-h">No story yet</h2>
          <p className="tl-empty-p">Add a story, and its scenes flow along here in the order they happen in your world.</p>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => useApp.getState().setNewStoryOpen(true)}>
            New story…
          </Button>
        </div>
      ) : (
        <ViewLoading />
      )}
    </div>
  )
}

/** Before any scene has a date: what the river will show, and the way to the When box. */
function NoDates({ timeline }: { timeline: Timeline }): React.JSX.Element {
  const go = (): void => {
    const first = timeline.points.find((p) => p.kind === 'scene')
    const app = useApp.getState()
    if (first?.storyId && !app.sceneId) app.selectScene(first.id, first.storyId)
    openSceneTab('card')
  }
  return (
    <div className="tl-empty">
      <RiverArt className="tl-empty-art" />
      <h2 className="tl-empty-h">No dates yet</h2>
      <p className="tl-empty-p">
        Give a scene a date in the When box on its scene card, in your own words: “Day 12, Year 3, at dusk” or “12 March 1204”. Scenes and
        events with a date flow along here in the order they happen in your world, spaced by the time between them, with a lane for each
        character.
      </p>
      <Button variant="primary" icon={<CalendarRange size={15} />} onClick={go}>
        Go to the scene card
      </Button>
    </div>
  )
}
