// The desk's room switch, in the middle of the top bar: Write, Plan, World and Check on a sunken track, the room showing
// raised on a paper pill that glides to the next one (components/ui/GlidePill). The pill slides in once when the desk
// first shows (layout/desk/desk.css). Settings belongs to no room: no pill then. In a window under 1200px the rooms not
// showing are their icons alone.
import { GlidePill } from '@/components/ui/GlidePill'
import { Eye, Globe2, List, Pencil, type IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { AREAS, areaOf, type Area } from '@/layout/areas'
import { openRoom } from './rooms'

const ICONS: Record<Area, IconType> = { write: Pencil, plan: List, world: Globe2, check: Eye }

export function RoomSwitch(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const current = areaOf(view)
  return (
    <nav aria-label="Rooms" data-desk-rooms className="desk-rooms relative flex h-9 items-center rounded-[12px] p-[3px]">
      <GlidePill className="desk-room-pill" />
      {AREAS.map((a) => {
        const Icon = ICONS[a.id]
        const on = current === a.id
        return (
          <button
            key={a.id}
            type="button"
            aria-current={on ? 'page' : undefined}
            title={`${a.label}: ${a.hint}`}
            onClick={() => openRoom(a.id)}
            className={cn(
              'desk-room relative z-[1] flex h-[30px] items-center justify-center gap-[5px] rounded-[9px] px-3 text-[13px] whitespace-nowrap',
              on && 'is-on',
              !on && 'max-[1200px]:px-2.5'
            )}
          >
            <Icon size={16} selected={on} />
            {/* In a smaller window only the room showing keeps its word (the others say theirs on hover and to a screen
                reader), so the rooms never run under the bar's other buttons. */}
            <span className={cn(!on && 'max-[1200px]:sr-only')}>{a.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
