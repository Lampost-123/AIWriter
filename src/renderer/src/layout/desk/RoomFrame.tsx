// The desk's frame for every page but the writing page (the New look's desk layout): the room's name in the serif, with
// where Adam is in small capitals above it, the room's links in a quiet row beside it (the same links as the panels'
// side list, layout/areaLinks.ts), and the page itself on a sheet of paper lying on the lit desk. The rooms are the
// areas (layout/areas.ts); Settings belongs to none and has its own list inside.
import * as M from '@radix-ui/react-dropdown-menu'
import { createContext, useState, type ReactNode } from 'react'
import { ChevronDown } from '@/components/ui/icons'
import { GlidePill } from '@/components/ui/GlidePill'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { KIND_INK } from '@/features/world/kindIcons'
import { useCodex } from '@/features/codex/codexStore'
import { AREAS, areaOf, type Area } from '@/layout/areas'
import { boardLink, chapterLinks, checkLinks, planLinks, worldLinks, worldViewLinks, writeLinks, type AreaLink, type LinkContext } from '@/layout/areaLinks'
import { useLinkContext } from '@/layout/AreaList'
import { useArrival } from './arrival'
import { GUTTER, useDeskFrame, useSheetGlide } from './deskFit'
import { spineShowsIn } from './rooms'

/**
 * Where a page lays something over its whole room (the World room's dossier, over the gallery and its scrim over the
 * room): an element at the room's frame, outside the sheet (which clips), for a portal. Null until it is there.
 */
export const RoomOverlay = createContext<HTMLElement | null>(null)

/** A link in the room's row. */
function SubLink({ link }: { link: AreaLink }): React.JSX.Element {
  const Icon = link.icon
  return (
    <button
      type="button"
      aria-current={link.active ? 'page' : undefined}
      title={link.hint}
      disabled={link.disabled}
      onClick={link.run}
      className={cn('desk-sublink relative z-[1] flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] whitespace-nowrap', link.active && 'is-on')}
    >
      <Icon size={15} selected={link.active} />
      <span>{link.label}</span>
    </button>
  )
}

const menuItem = 'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2'

/** Several links behind one (Plan a chapter, By kind): a menu, lit when one of them is the page showing. */
function SubMenu({ label, links, icon: Icon }: { label: string; links: AreaLink[]; icon: AreaLink['icon'] }): React.JSX.Element | null {
  if (!links.length) return null
  const on = links.find((l) => l.active)
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-current={on ? 'page' : undefined}
        className={cn('desk-sublink relative z-[1] flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] pl-2.5 pr-2 text-[13px] whitespace-nowrap outline-none', on && 'is-on')}
      >
        <Icon size={15} selected={!!on} />
        <span>{on ? on.label : label}</span>
        <ChevronDown size={12} className="text-faint" />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[220px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</M.Label>
          {links.map((l) => {
            const LinkIcon = l.icon
            return (
              <M.Item key={l.id} disabled={l.disabled} onSelect={l.run} className={menuItem}>
                {l.kind ? (
                  <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]', KIND_INK[l.kind].tile)}>
                    <LinkIcon size={14} />
                  </span>
                ) : (
                  <LinkIcon size={15} className="text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{l.label}</span>
                {l.count != null ? <span className="text-[11.5px] tabular-nums text-faint">{l.count}</span> : null}
              </M.Item>
            )
          })}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** The room's row of links. */
function RoomLinks({ room, c }: { room: Area; c: LinkContext }): React.JSX.Element {
  const links: ReactNode =
    room === 'write' ? (
      writeLinks(c).map((l) => <SubLink key={l.id} link={l} />)
    ) : room === 'plan' ? (
      (() => {
        const [outline, , , threads, recipes] = planLinks(c)
        const chapters = chapterLinks(c)
        return (
          <>
            <SubLink link={boardLink(c)} />
            <SubLink link={outline} />
            <SubMenu label="Plan a chapter" icon={chapters[0]?.icon ?? outline.icon} links={chapters} />
            <SubLink link={threads} />
            <SubLink link={recipes} />
          </>
        )
      })()
    ) : room === 'world' ? (
      (() => {
        const [codex, ...kinds] = worldLinks(c)
        // The World room's gallery shows plot threads in All, so its Everything counts them too (the panels' codex doesn't).
        const everything = { ...codex, count: c.counts ? Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0) : null }
        return (
          <>
            <SubLink link={everything} />
            <SubMenu label="By kind" icon={everything.icon} links={kinds} />
            {worldViewLinks(c).map((l) => (
              <SubLink key={l.id} link={l} />
            ))}
          </>
        )
      })()
    ) : (
      checkLinks(c).map((l) => <SubLink key={l.id} link={l} />)
    )
  const label = AREAS.find((a) => a.id === room)?.label ?? ''
  return (
    <nav aria-label={label} data-desk-sublinks className="desk-sublinks relative flex min-w-0 flex-wrap items-center justify-end gap-0.5 rounded-[12px] p-[3px]">
      <GlidePill className="desk-sub-pill" />
      {links}
    </nav>
  )
}

/** What the small capitals over the room's name say: the world, or the story. */
function useWhere(room: Area | null): string {
  const world = useApp((s) => s.world?.name ?? '')
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId)?.title ?? '')
  if (room === 'world' || room === null) return world
  return story ? `${world} · ${story}` : world
}

export function RoomFrame({ view, children }: { view: View; children: ReactNode }): React.JSX.Element {
  const room = areaOf(view)
  const links = useLinkContext()
  // (The World room's gallery has the world's name as its own heading, so the small capitals don't say it twice.)
  const gallery = view.kind === 'codex' || view.kind === 'entries'
  // Under an entry's dossier, the room's links stay on the gallery's tab (the dossier is over that page, not another).
  const tab = useCodex((s) => s.filters.kind)
  const c: LinkContext =
    view.kind === 'entries' && view.entryId
      ? { ...links, view: tab ? { kind: 'entries', entryKind: tab, entryId: null } : { kind: 'codex' } }
      : links
  const where = useWhere(room)
  const name = room ? (AREAS.find((a) => a.id === room)?.label ?? '') : 'Settings'
  // The first time a room shows this session, its sheet rises into place (layout/desk/arrival.ts).
  const arriving = useArrival(`room:${room ?? 'settings'}`)
  // Beside the story's spine (the World room's pages): the room's heading and sheet keep clear of it, centred in the room
  // it leaves, and glide across with it as it opens out or collapses.
  const spine = spineShowsIn(view)
  const frame = useDeskFrame()
  const glide = useSheetGlide(frame)
  const clear = spine ? frame.leftMin - GUTTER : 0
  const [overlay, setOverlay] = useState<HTMLElement | null>(null)
  return (
    <div
      data-desk-room={room ?? 'settings'}
      // The relationship map's wider sheet (features/map/desk/deskMap.css). Only the map is marked: a mark changing as
      // the World room's gallery flips a card into its dossier would spoil the flip.
      data-page={view.kind === 'map' ? 'map' : undefined}
      data-arrive={arriving || undefined}
      data-spine={spine ? (frame.full ? 'full' : 'slim') : undefined}
      className="desk-room absolute inset-0 flex flex-col"
      style={spine ? ({ '--room-left': `${clear}px`, transition: glide } as React.CSSProperties) : undefined}
    >
      {/* Settings, in no room, has its own heading and list on the sheet. */}
      {room ? (
        <div className="desk-room-head flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-3 pt-2">
          <div className="min-w-0">
            {where && !gallery ? <p className="desk-caps truncate">{where}</p> : null}
            <p className="desk-room-title">{name}</p>
          </div>
          <RoomLinks room={room} c={c} />
        </div>
      ) : (
        <div className="h-3 shrink-0" />
      )}
      {/* The page on its sheet of paper. */}
      <div className="desk-room-sheet relative min-h-0 flex-1 overflow-hidden">
        <RoomOverlay.Provider value={overlay}>{children}</RoomOverlay.Provider>
      </div>
      <div ref={setOverlay} data-room-overlay className="contents" />
    </div>
  )
}
