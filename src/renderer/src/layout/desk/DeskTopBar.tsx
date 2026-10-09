// The desk's top bar (the New look's desk layout), 52px, lying on the lit frame. Left: the lamp mark (the story's
// home, as is the story's name), the world (its menu: other worlds, the start screen, rename, new, export, the sample world, recipes) and the
// story (switch stories, its settings), with the sample world's chip. Middle: the rooms. Right: an update waiting, the
// memory when it is reading or in trouble, the command bar, the status island, focus mode and Settings.
// Nothing in it is cut short at the sizes the desk is made for; in a small window the command bar narrows first.
import { useRef } from 'react'
import { House, Settings as SettingsIcon } from '@/components/ui/icons'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { AskButton } from '@/features/ask/AskButton'
import { StorySwitcher } from '@/features/binder/StorySwitcher'
import { FocusButton } from '@/features/look/FocusLayer'
import { KeeperStatus } from '@/features/memory/KeeperStatus'
import { SampleWorldChip } from '@/features/setup/SampleWorldBar'
import { openStoryHome } from '@/features/desk/home/open'
import { goToStartScreen } from '@/features/start/home'
import { RenameWorld, useSettingsKey, WorldMenu } from '@/layout/TopBar'
import { UpdateBanner } from '@/layout/UpdateBanner'
import { CommandBar } from './CommandBar'
import { DrawerToggle } from './DrawerToggle'
import { RoomSwitch } from './RoomSwitch'
import { StatusIsland } from './StatusIsland'

/** The lamp: AI Write's mark on a small lit tile. */
export function LampMark(): React.JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 4.4a2 2 0 0 1 4 0" />
      <path d="M8.3 7h7.4l-1-2.4H9.3z" />
      <path d="M8.6 7v10.4h6.8V7" />
      <path d="M7.2 20h9.6" />
      <path d="M9.4 17.4L9 20M14.6 17.4L15 20" />
      <path d="M12 10.1c1.1 1.2 1.6 2 1.6 2.8a1.6 1.6 0 0 1-3.2 0c0-.8.5-1.6 1.6-2.8z" />
    </svg>
  )
}

export function DeskTopBar(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const worldButton = useRef<HTMLButtonElement>(null)
  useSettingsKey()

  return (
    <header
      data-desk-topbar
      // The rooms sit in the middle of the window; a long world or story name moves them along rather than being cut
      // short (under 1440px the sample world's chip steps aside, and only in the smallest windows do the names give way).
      className="desk-topbar group/bar relative z-30 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 min-[1440px]:grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)]"
    >
      <div className="flex min-w-0 items-center">
        {/* Back to the start screen, where Adam picks what to work on. */}
        <IconButton label="Home" title="Home: pick a world or story (the start screen)" onClick={goToStartScreen} className="mr-1">
          <House size={18} />
        </IconButton>
        {/* The story's home (the world menu has the start screen). */}
        <button
          type="button"
          aria-label="Story home"
          aria-current={view.kind === 'storyHome' ? 'page' : undefined}
          title="Story home: the book, its chapters, where you left off (the start screen is in the world’s menu)"
          onClick={openStoryHome}
          className="desk-mark grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]"
        >
          <LampMark />
        </button>
        {/* The world and the story; renaming the world happens over both, so nothing moves. */}
        <div className="relative ml-2 flex min-w-0 items-center">
          <WorldMenu trigger={worldButton} />
          <span aria-hidden className="mx-[3px] font-heading text-[17px] leading-5 text-faint">
            /
          </span>
          <StorySwitcher bar onTitle={openStoryHome} />
          <RenameWorld trigger={worldButton} />
        </div>
        <div className="ml-3 flex shrink-0 items-center max-[1440px]:hidden">
          <SampleWorldChip />
        </div>
      </div>
      <RoomSwitch />
      <div className="flex min-w-0 items-center justify-end gap-2">
        {/* A downloaded update is offered here; nothing else moves for it (the command bar gives up its words). */}
        <div data-update-slot className="flex min-w-0 justify-end">
          <UpdateBanner />
        </div>
        <span data-tour="keeper" className="contents">
          <KeeperStatus quiet />
        </span>
        <div data-tour="command" className={cn('flex min-w-0 shrink justify-end', 'w-[240px] max-[1600px]:w-[150px] max-[1180px]:w-[104px]',
            // With Scene details beside it (the writing page), it narrows sooner, so the bar still fits.
            'group-has-[[data-drawer-toggle]]/bar:max-[1599px]:w-[64px]',
            'group-has-[[data-update-slot]>[role=status]:not([aria-hidden=true])]/bar:w-9')}>
          <CommandBar />
        </div>
        {/* The scene drawer, shown and hidden from here (on the writing page). */}
        <DrawerToggle />
        <StatusIsland />
        {/* Ask the world's chat, always one click away. */}
        <AskButton />
        <FocusButton />
        <IconButton
          label="Settings"
          title={withShortcut('Settings', 'settings')}
          active={view.kind === 'settings'}
          onClick={() => navigate(view.kind === 'settings' ? { kind: 'write' } : { kind: 'settings', tab: 'models' })}
        >
          <SettingsIcon size={18} />
        </IconButton>
      </div>
    </header>
  )
}
