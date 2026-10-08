// The New look's side list: beside the area rail, one focused list for the area showing (areas.ts), under a serif
// heading. Write: the story's chapters and scenes (the binder), the style guide and the story's settings. Plan: the
// outline, each chapter's plan, ideas and the interview on a scene's card, the plot threads and story recipes.
// World: everything in the world by kind, the relationship map, the timeline and building from a summary. Check:
// consistency, what the memory changed and the scene's issues. Classic keeps today's binder instead (Binder.tsx).
// The links themselves are layout/areaLinks.ts (the desk's room frame shows the same ones).
import type { ReactNode } from 'react'
import { ENTRY_KINDS } from '@shared/fields'
import { GlidePill } from '@/components/ui/GlidePill'
import type { IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Binder } from '@/features/binder/Binder'
import { useOutline } from '@/features/binder/outlineStore'
import { useEntryCounts } from '@/features/binder/WorldSection'
import { KIND_INK } from '@/features/world/kindIcons'
import { AREAS, areaOf, type Area } from './areas'
import { chapterLinks, checkLinks, planLinks, worldLinks, worldViewLinks, writeLinks, type AreaLink, type LinkContext } from './areaLinks'

/** The area last shown, kept while Settings (in no area) is open. */
let lastArea: Area = 'write'

/** Where Adam is, for the links (layout/areaLinks.ts). */
export function useLinkContext(): LinkContext {
  const view = useApp((s) => s.view)
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const issuesShowing = useApp((s) => s.view.kind === 'write' && s.inspectorTab === 'issues' && !!s.settings?.layout.inspectorOpen)
  const counts = useEntryCounts()
  const { outline } = useOutline()
  return { view, storyId, sceneId, counts, chapters: outline?.chapters ?? [], issuesShowing }
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

/** A side row for one of the area's links. */
const Row = ({ link }: { link: AreaLink }): React.JSX.Element => (
  <SideLink
    icon={link.icon}
    kind={link.kind}
    label={link.label}
    hint={link.hint}
    count={link.count}
    active={link.active}
    disabled={link.disabled}
    onClick={link.run}
  />
)

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

function WriteList(): React.JSX.Element {
  const c = useLinkContext()
  return (
    <>
      <div className="min-h-0 flex-1">
        <Binder world={false} />
      </div>
      <Links label="Story" className="shrink-0 border-t border-line pb-2 pt-2">
        {writeLinks(c)
          .filter((l) => l.id !== 'page')
          .map((l) => (
            <Row key={l.id} link={l} />
          ))}
      </Links>
    </>
  )
}

function PlanList(): React.JSX.Element {
  const c = useLinkContext()
  const chapters = chapterLinks(c)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="Plan">
        {planLinks(c).map((l) => (
          <Row key={l.id} link={l} />
        ))}
      </Links>
      {chapters.length ? (
        <>
          <Label>Plan a chapter</Label>
          <Links label="Chapters">
            {chapters.map((l) => (
              <Row key={l.id} link={l} />
            ))}
          </Links>
        </>
      ) : null}
    </div>
  )
}

function WorldList(): React.JSX.Element {
  const c = useLinkContext()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="World">
        {worldLinks(c).map((l) => (
          <Row key={l.id} link={l} />
        ))}
      </Links>
      <Label>See it whole</Label>
      <Links label="World views">
        {worldViewLinks(c).map((l) => (
          <Row key={l.id} link={l} />
        ))}
      </Links>
    </div>
  )
}

function CheckList(): React.JSX.Element {
  const c = useLinkContext()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <Links label="Check">
        {checkLinks(c).map((l) => (
          <Row key={l.id} link={l} />
        ))}
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
      {area === 'write' ? <WriteList /> : area === 'plan' ? <PlanList /> : area === 'world' ? <WorldList /> : <CheckList />}
    </div>
  )
}
