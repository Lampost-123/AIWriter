// The New look's side list: beside the area rail, one focused list for the area showing (areas.ts), under a serif
// heading. Write: the story's chapters and scenes (the binder), the style guide and the story's settings. Plan: the
// outline, each chapter's plan, ideas and the interview on a scene's card, the plot threads and story recipes.
// World: everything in the world by kind, the relationship map, the timeline and building from a summary. Check:
// consistency, what the memory changed and the scene's issues. Classic keeps today's binder instead (Binder.tsx).
import type { ReactNode } from 'react'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import { GlidePill } from '@/components/ui/GlidePill'
import {
  CalendarRange,
  CircleAlert,
  CookingPot,
  History,
  LayoutGrid,
  Lightbulb,
  ListTree,
  MessageCircleQuestion,
  Network,
  NotebookText,
  Palette,
  SearchCheck,
  Settings2,
  Spool,
  WandSparkles,
  type IconType
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { Binder } from '@/features/binder/Binder'
import { useOutline } from '@/features/binder/outlineStore'
import { useEntryCounts } from '@/features/binder/WorldSection'
import { openConsistency } from '@/features/consistency/checkStore'
import { openOutlineHelper } from '@/features/outline/open'
import { openRecipes } from '@/features/recipes/recipeStore'
import { openStorySettings } from '@/features/stories/storyActions'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { openWorldBuilder } from '@/features/worldBuilder/open'
import { AREAS, areaOf, type Area } from './areas'

/** The area last shown, kept while Settings (in no area) is open. */
let lastArea: Area = 'write'

/** Opens the open scene's card in the scene panel beside the page (its ideas for what happens next and Interview me). */
function openSceneCard(): void {
  const app = useApp.getState()
  app.setInspectorTab('card')
  app.peekEntry(null)
  if (app.askOpen) app.setAskOpen(false)
  if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
  app.navigate({ kind: 'write' })
}

/** One row in a side list: an icon (or a kind's tinted tile), the words, and a count when there is one. */
function SideLink({
  icon: Icon,
  kind,
  label,
  hint,
  count,
  active,
  disabled,
  onClick
}: {
  icon: IconType
  /** A kind of thing in the world: the icon sits on a tile in its ink. */
  kind?: (typeof ENTRY_KINDS)[number]
  label: string
  hint?: string
  count?: number | null
  active: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      title={hint}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex h-8 w-full shrink-0 items-center gap-2.5 rounded-[9px] px-2 text-left text-[13px] outline-none',
        'transition-colors duration-(--dur-quick) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
        'disabled:pointer-events-none disabled:opacity-50',
        active ? 'font-medium text-fg' : 'text-fg/90 hover:bg-surface-2'
      )}
    >
      {kind ? (
        <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]', KIND_INK[kind].tile)}>
          <Icon size={14} selected={active} />
        </span>
      ) : (
        <span className={cn('grid w-[22px] shrink-0 place-items-center', active ? 'text-accent' : 'text-muted')}>
          <Icon size={17} selected={active} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? <span className="text-[11.5px] tabular-nums text-faint">{count}</span> : null}
    </button>
  )
}

/** A list of links with the gliding pill behind the one showing. */
function Links({ children, className, label }: { children: ReactNode; className?: string; label: string }): React.JSX.Element {
  return (
    <nav aria-label={label} className={cn('relative flex flex-col gap-0.5 px-1.5', className)}>
      <GlidePill />
      {children}
    </nav>
  )
}

const Label = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <h3 className="px-3.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>
)

const is = (view: View, kind: View['kind']): boolean => view.kind === kind

function WriteList({ view }: { view: View }): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  return (
    <>
      <div className="min-h-0 flex-1">
        <Binder world={false} />
      </div>
      <Links label="Story" className="shrink-0 border-t border-line pb-2 pt-2">
        <SideLink icon={Palette} label="Style guide" active={is(view, 'style')} onClick={() => useApp.getState().navigate({ kind: 'style' })} />
        <SideLink
          icon={Settings2}
          label="Story settings"
          disabled={!storyId}
          active={is(view, 'story')}
          onClick={() => storyId && openStorySettings(storyId)}
        />
      </Links>
    </>
  )
}

function PlanList({ view }: { view: View }): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const { outline } = useOutline()
  const chapters = outline?.chapters ?? []
  const planning = view.kind === 'outline' ? view : null
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="Plan">
        <SideLink
          icon={ListTree}
          label="Outline helper"
          hint="Acts, chapters and scene cards suggested from your premise"
          disabled={!storyId}
          active={!!planning && !planning.chapterId}
          onClick={() => storyId && openOutlineHelper(storyId)}
        />
        <SideLink
          icon={Lightbulb}
          label="Next scene ideas"
          hint="On an empty scene’s card: three directions for what happens next"
          disabled={!sceneId}
          active={false}
          onClick={openSceneCard}
        />
        <SideLink
          icon={MessageCircleQuestion}
          label="Interview me"
          hint="On the scene’s card: a few questions, and the card filled in from your answers"
          disabled={!sceneId}
          active={false}
          onClick={openSceneCard}
        />
        <SideLink icon={Spool} label="Plot threads board" active={is(view, 'threads')} onClick={() => useApp.getState().navigate({ kind: 'threads' })} />
        <SideLink icon={CookingPot} label="Story recipes" active={is(view, 'recipes') || is(view, 'recipePlan')} onClick={openRecipes} />
      </Links>
      {storyId && chapters.length ? (
        <>
          <Label>Plan a chapter</Label>
          <Links label="Chapters">
            {chapters.map((c, i) => (
              <SideLink
                key={c.id}
                icon={NotebookText}
                label={c.title.trim() || `Chapter ${i + 1}`}
                active={planning?.chapterId === c.id}
                onClick={() => useApp.getState().navigate({ kind: 'outline', storyId, chapterId: c.id })}
              />
            ))}
          </Links>
        </>
      ) : null}
    </div>
  )
}

function WorldList({ view }: { view: View }): React.JSX.Element {
  const counts = useEntryCounts()
  const navigate = useApp((s) => s.navigate)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="World">
        <SideLink
          icon={LayoutGrid}
          label="Everything"
          hint="The codex: every character, place and more, as cards"
          count={counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : null}
          active={is(view, 'codex')}
          onClick={() => navigate({ kind: 'codex' })}
        />
        {ENTRY_KINDS.map((kind) => (
          <SideLink
            key={kind}
            kind={kind}
            icon={KIND_ICONS[kind]}
            label={KIND_LABELS[kind].many}
            count={counts ? (counts[kind] ?? 0) : null}
            active={(view.kind === 'entries' || view.kind === 'builder') && view.entryKind === kind}
            onClick={() => navigate({ kind: 'entries', entryKind: kind, entryId: null })}
          />
        ))}
      </Links>
      <Label>See it whole</Label>
      <Links label="World views">
        <SideLink icon={Network} label="Relationship map" active={is(view, 'map')} onClick={() => navigate({ kind: 'map' })} />
        <SideLink icon={CalendarRange} label="Timeline" active={is(view, 'timeline')} onClick={() => navigate({ kind: 'timeline' })} />
        <SideLink icon={WandSparkles} label="Build from a summary" active={is(view, 'worldBuilder')} onClick={() => openWorldBuilder()} />
      </Links>
    </div>
  )
}

function CheckList({ view }: { view: View }): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const issuesShowing = useApp((s) => s.view.kind === 'write' && s.inspectorTab === 'issues' && !!s.settings?.layout.inspectorOpen)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="Check">
        <SideLink
          icon={SearchCheck}
          label="Consistency"
          hint="The story’s issues by chapter and scene, and checking a chapter or the whole story"
          disabled={!storyId}
          active={is(view, 'consistency')}
          onClick={() => storyId && openConsistency(storyId)}
        />
        <SideLink
          icon={History}
          label="What changed"
          hint="What the memory keeper changed, with Undo"
          active={is(view, 'memory')}
          onClick={() => useApp.getState().navigate({ kind: 'memory', sceneId: null })}
        />
        <SideLink
          icon={CircleAlert}
          label="This scene’s issues"
          disabled={!sceneId}
          active={issuesShowing}
          onClick={() => {
            const app = useApp.getState()
            app.setInspectorTab('issues')
            app.peekEntry(null)
            if (app.askOpen) app.setAskOpen(false)
            if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
            app.navigate({ kind: 'write' })
          }}
        />
      </Links>
    </div>
  )
}

/** The side list of the area showing. */
export function AreaList(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const world = useApp((s) => s.world?.name ?? '')
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId)?.title ?? '')
  const area = areaOf(view) ?? lastArea
  lastArea = area
  const meta = AREAS.find((a) => a.id === area)!
  // Write's story shows in its story switcher just below.
  const sub = area === 'world' ? world : area === 'write' ? '' : story
  return (
    <div className="flex h-full min-h-0 flex-col" data-area-list={area}>
      <h2 className="shrink-0 px-3.5 pb-2 pt-3 font-heading text-[19px] font-semibold leading-tight tracking-[-0.01em] text-fg">
        {meta.label}
        {sub ? <small className="mt-0.5 block truncate font-sans text-[12px] font-normal tracking-normal text-faint">{sub}</small> : null}
      </h2>
      {area === 'write' ? (
        <WriteList view={view} />
      ) : area === 'plan' ? (
        <PlanList view={view} />
      ) : area === 'world' ? (
        <WorldList view={view} />
      ) : (
        <CheckList view={view} />
      )}
    </div>
  )
}
