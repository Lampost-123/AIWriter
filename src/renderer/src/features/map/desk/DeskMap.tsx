// The desk's relationship map (UI overhaul): World room › Relationship map on the desk. The panels and Classic keep
// features/map/RelationshipMap.tsx. It reads the same map from the main process (with the desk's extra detail: each
// tie's history, what changed at a stop, the strip's titles, the point of view) and shows it on a wide sheet: a
// timeline strip, the stage (MapStage), a legend, zoom and side cards. See deskMap.css for the look and motion.
import './deskMap.css'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { AsOf, ID } from '@shared/types'
import type { MapGroup } from '@shared/contracts/worldViews'
import { Plus } from '@/components/ui/icons'
import { Button, EmptyState, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { AsSeenIn } from '@/features/views/AsSeenIn'
import { hasOtherKinds, inSentence, stopIndex } from '@/features/views/asOfLogic'
import { StoryFilter, useViewStory, useWorldView, ViewError, ViewLoading } from '@/features/timeline/viewParts'
import { MapStage } from './MapStage'
import { artHue } from '@/features/desk/world/galleryLogic'

export function DeskMap(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const sceneId = useApp((s) => s.sceneId)
  const stories = useApp((s) => s.stories)
  const [at, setAt] = useState<AsOf | null>(null)
  const [quick, setQuick] = useState(false)
  const [groupId, setGroupId] = useState<ID | null>(null)
  const groupName = useRef('')

  // With no point picked, the map opens at the scene Adam is in (or the story's end).
  const load = useCallback((id: ID) => api.getRelationshipMap(id, at, at ? null : sceneId), [at, sceneId])
  const key = at ? JSON.stringify(at) : `scene:${sceneId ?? ''}`
  const { data, error, retry } = useWorldView(storyId, load, key, at ? 40 : 0)

  const pickStory = (id: ID): void => {
    setStoryId(id)
    setAt(null)
    setGroupId(null)
  }
  const pickGroup = (id: ID | null): void => {
    groupName.current = data?.groups.find((g) => g.id === id)?.name ?? ''
    setGroupId(id)
  }
  const pickAt = useCallback((a: AsOf, how: 'key' | 'pointer') => {
    setQuick(how === 'key')
    setAt(a)
  }, [])

  const groupOptions = useMemo(() => {
    const options = (data?.groups ?? []).map((g) => ({ value: g.id, label: g.name }))
    if (groupId && !options.some((o) => o.value === groupId)) options.push({ value: groupId, label: groupName.current || 'This group' })
    return options
  }, [data, groupId])

  // The strip shows the stop asked for at once, while the map for it loads.
  const index = data ? (at ? Math.max(0, stopIndex(data.stops, at)) : (data.detail?.atStop ?? data.stops.length - 1)) : 0
  const pairs = data ? new Set(data.links.map((l) => (l.aId < l.bId ? `${l.aId}|${l.bId}` : `${l.bId}|${l.aId}`))).size : 0
  const group = groupId ? data?.groups.find((g) => g.id === groupId) : undefined

  return (
    <div className="dm" data-desk-map data-quick={quick || undefined}>
      <header className="dm-head">
        <div>
          <h1 className="dm-title">Relationship map</h1>
          <p className="dm-sub">Who is tied to whom, and how each of them feels about it, scene by scene.</p>
        </div>
        <div className="dm-head-r">
          {data?.any ? (
            <span className="dm-count" data-map-count>
              <b>{data.nodes.length}</b> {data.nodes.length === 1 ? 'character' : 'characters'} · <b>{pairs}</b> {pairs === 1 ? 'tie' : 'ties'}
            </span>
          ) : null}
          <AsSeenIn value={storyId} onChange={pickStory} className="w-[200px]" />
          {hasOtherKinds(stories) ? null : <StoryFilter value={storyId} onChange={pickStory} />}
          {groupOptions.length ? (
            <label className="w-[200px]">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">Group</span>
              <Select value={groupId} onChange={pickGroup} options={groupOptions} allowNone noneLabel="Everyone" />
            </label>
          ) : null}
        </div>
      </header>
      {data ? (
        !data.any ? (
          <div className="dm-stage">
            <EmptyMap />
          </div>
        ) : (
          <>
            <MapStage key={data.storyId} map={data} groupId={groupId} index={index} quick={quick} onPick={pickAt} />
            {groupId && group && !group.memberIds.length ? (
              <NobodyInGroup name={groupName.current || group.name} group={group} label={data.label} onShowEveryone={() => pickGroup(null)} />
            ) : null}
          </>
        )
      ) : error ? (
        <ViewError what="The relationship map" error={error} onRetry={retry} />
      ) : !storyId ? (
        <EmptyState
          title="No story yet"
          className="mt-[10vh]"
          actions={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => useApp.getState().setNewStoryOpen(true)}>
              New story…
            </Button>
          }
        >
          Add a story, and the relationships between its characters appear here.
        </EmptyState>
      ) : (
        <ViewLoading />
      )}
    </div>
  )
}

function NobodyInGroup({ name, group, label, onShowEveryone }: { name: string; group: MapGroup; label: string; onShowEveryone: () => void }): React.JSX.Element {
  return (
    <div className="dm-float dm-note" style={{ top: 'auto', bottom: 72, left: '50%', translate: '-50% 0' }} role="status">
      <span>
        Nobody belongs to {name} as of {inSentence(label)}.
        {group.joinsLater ? ' Move along the strip to see who joins.' : group.hadMembers ? ' Move back along the strip to see who belonged.' : ''}
      </span>
      <button type="button" className="dm-link" onClick={onShowEveryone}>
        Show everyone
      </button>
    </div>
  )
}

/** No relationships anywhere along the story yet: three coins waiting to be tied, the threads drawing in and fading. */
function EmptyMap(): React.JSX.Element {
  const coins = [
    { id: 'empty-a', x: 70, y: 112, r: 30 },
    { id: 'empty-b', x: 210, y: 60, r: 24 },
    { id: 'empty-c', x: 250, y: 150, r: 26 }
  ]
  return (
    <div className="dm-empty" data-map-empty>
      <div className="dm-empty-in">
        <svg className="dm-art" width={320} height={200} viewBox="0 0 320 200" aria-hidden>
          <defs>
            {coins.map((c) => (
              <linearGradient key={c.id} id={`dm-${c.id}`} x1="0" y1="0" x2="0.4" y2="1">
                <stop offset="0" stopColor={`hsl(${artHue('character', c.id)} 46% 68%)`} />
                <stop offset="1" stopColor={`hsl(${artHue('character', c.id)} 46% 32%)`} />
              </linearGradient>
            ))}
          </defs>
          <path className="dm-art-line" pathLength={1} d="M70,112 Q130,60 210,60" stroke="var(--k-char)" />
          <path className="dm-art-line" pathLength={1} d="M210,60 Q250,100 250,150" stroke="var(--k-place)" />
          <path className="dm-art-line" pathLength={1} d="M70,112 Q150,170 250,150" stroke="var(--k-event)" />
          {coins.map((c) => (
            <g key={c.id} className="dm-art-coin">
              <circle cx={c.x} cy={c.y} r={c.r + 4} fill="var(--page)" />
              <circle cx={c.x} cy={c.y} r={c.r} fill={`url(#dm-${c.id})`} />
              <circle cx={c.x} cy={c.y} r={c.r - 4} fill="none" stroke="rgb(255 255 255 / 0.3)" />
              <circle cx={c.x} cy={c.y - c.r * 0.22} r={c.r * 0.26} fill="rgb(255 251 246 / 0.9)" />
              <path
                d={`M${c.x - c.r * 0.5},${c.y + c.r * 0.55} Q${c.x},${c.y + c.r * 0.05} ${c.x + c.r * 0.5},${c.y + c.r * 0.55}`}
                fill="rgb(255 251 246 / 0.9)"
              />
            </g>
          ))}
        </svg>
        <h2>No relationships yet</h2>
        <p>
          Relationships come from your story: as you write, the memory notes how characters are tied to each other (sister, rival, owes
          money) and how each feels about it. You can also add them yourself under Relationships on a character’s page.
        </p>
        <div className="dm-empty-actions">
          <Button variant="primary" onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: null })}>
            Go to characters
          </Button>
        </div>
      </div>
    </div>
  )
}
