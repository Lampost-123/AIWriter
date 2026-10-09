// The New look's area rail: a narrow column down the left edge with the four areas (Write, Plan, World, Check),
// and Ask the world and Settings at its foot. The area of the screen showing is a raised pill (areas.ts says which
// screen is in which), so opening a screen from anywhere lights its area here. Choosing an area opens its main
// screen: the page, the outline helper, the codex, the story's consistency.
import { GlidePill } from '@/components/ui/GlidePill'
import { Eye, Globe2, List, MessagesSquare, Pencil, Settings as SettingsIcon, type IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { closeAsk, openAsk } from '@/features/ask/open'
import { openConsistency } from '@/features/consistency/checkStore'
import { openOutlineHelper } from '@/features/outline/open'
import { AREAS, areaOf, type Area } from './areas'

const ICONS: Record<Area, IconType> = { write: Pencil, plan: List, world: Globe2, check: Eye }

/** Opens an area's main screen. */
export function openArea(area: Area): void {
  const app = useApp.getState()
  if (area === 'write') app.navigate({ kind: 'write' })
  else if (area === 'plan') {
    if (app.storyId) openOutlineHelper(app.storyId)
    else app.navigate({ kind: 'threads' })
  } else if (area === 'world') app.navigate({ kind: 'codex' })
  else if (app.storyId) openConsistency(app.storyId)
  else app.navigate({ kind: 'memory', sceneId: null })
}

function RailButton({
  label,
  title,
  icon: Icon,
  on,
  pressed,
  onClick
}: {
  label: string
  title: string
  icon: IconType
  on: boolean
  /** A toggle (Ask the world): says whether it is open. */
  pressed?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        'relative grid w-[54px] justify-items-center gap-[3px] rounded-xl pb-1.5 pt-[7px] text-[10.5px] font-medium',
        'transition-[color,background-color,transform,scale] duration-(--dur-quick) ease-glide active:scale-[0.94]',
        on || pressed ? 'text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      <Icon size={21} selected={on || pressed} />
      <span>{label}</span>
    </button>
  )
}

export function AreaRail(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const askShowing = useApp((s) => s.askOpen && s.view.kind === 'write' && !!s.settings?.layout.inspectorOpen)
  const current = areaOf(view)
  return (
    <nav aria-label="Areas" data-focus-chrome className="flex w-16 shrink-0 flex-col items-center pb-3 pt-1.5">
      <div className="relative flex flex-col items-center gap-1">
        <GlidePill className="rounded-xl" />
        {AREAS.map((a) => (
          <RailButton key={a.id} label={a.label} title={`${a.label}: ${a.hint}`} icon={ICONS[a.id]} on={current === a.id} onClick={() => openArea(a.id)} />
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-1">
        <RailButton
          label="Ask"
          title="Ask the world: questions about your story, answered from its memory"
          icon={MessagesSquare}
          on={false}
          pressed={askShowing}
          onClick={() => (askShowing ? closeAsk() : openAsk())}
        />
        <RailButton
          label="Settings"
          title={withShortcut('Settings', 'settings')}
          icon={SettingsIcon}
          on={view.kind === 'settings'}
          onClick={() => navigate(view.kind === 'settings' ? { kind: 'write' } : { kind: 'settings', tab: 'models' })}
        />
      </div>
    </nav>
  )
}
