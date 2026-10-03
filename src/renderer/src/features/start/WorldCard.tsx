// One world on the start screen: its name, how many stories and words, when it was last opened; opened up, its
// stories with what each is, their words and last edit. Each world and story has a menu (Open, Rename in place,
// Details; a world also Export, Make a copy and Delete; a story Delete).

import { BookOpen, ChevronRight, Copy, FileDown, FolderOpen, Globe2, Info, PenLine, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { LibraryStory, LibraryWorld } from '@shared/contracts/library'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { copyWorld, exportWorld } from '@/features/transfer/worldFiles'
import { CardMenu } from './CardMenu'
import { loadLibrary, setExpanded, useLibrary } from './libraryStore'
import {
  deleteStoryFromStart,
  openStoryFromStart,
  openWorldFromStart,
  renameStoryFromStart,
  renameWorldFromStart,
  storyDetails,
  worldDetails
} from './startActions'
import { editedText, storyKinds, wordsText, worldLine } from './startLogic'

/** Puts the keyboard back on an element once a name box has gone, unless Adam has clicked somewhere else meanwhile. */
const focusBack = (el: HTMLElement | null): void =>
  void requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    el?.focus()
  })

export function WorldCard({
  world,
  stories,
  byStory,
  isOpen,
  onDelete,
  style
}: {
  world: LibraryWorld
  /** The stories to list (only the ones a search found by title, or all). */
  stories: LibraryStory[]
  /** Found by a story's title: shown opened up. */
  byStory: boolean
  /** The world open now (behind the start screen). */
  isOpen: boolean
  onDelete: (w: LibraryWorld) => void
  style?: React.CSSProperties
}): React.JSX.Element {
  const expanded = useLibrary((s) => !!s.expanded[world.id]) || byStory
  const [renaming, setRenaming] = useState(false)
  const busy = useLibrary((s) => s.busy)
  const header = useRef<HTMLButtonElement>(null)
  const kinds = storyKinds(world.stories)
  const listId = `start-world-${world.id}`

  return (
    <li className="start-rise rounded-xl border border-line bg-surface shadow-soft" style={style}>
      <div className="flex items-center gap-1 pr-2.5">
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2">
            <ChevronRight size={15} className={cn('shrink-0 text-faint', expanded && 'rotate-90')} />
            <WorldIcon />
            <div className="min-w-0 flex-1">
              <div className="flex h-[22px] items-center">
                <InlineTitle
                  label="World name"
                  value={world.name}
                  className="h-[22px] text-[14.5px] font-semibold"
                  onCommit={(name) => renameWorldFromStart(world, name)}
                  onDone={() => {
                    setRenaming(false)
                    focusBack(header.current)
                  }}
                />
              </div>
              <p className="h-[18px] truncate text-[12.5px] leading-[18px] text-muted">{worldLine(world)}</p>
            </div>
          </div>
        ) : (
          <button
            ref={header}
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
            onClick={() => setExpanded(world.id, !expanded)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl py-3 pl-3 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          >
            <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform duration-150', expanded && 'rotate-90')} />
            <WorldIcon />
            <div className="min-w-0 flex-1">
              <div className="flex h-[22px] items-center gap-2">
                <span className="truncate text-[14.5px] font-semibold leading-[22px] text-fg">{world.name}</span>
                {isOpen ? <Badge tone="accent">Open now</Badge> : world.sample ? <Badge>Sample</Badge> : null}
              </div>
              <p className="h-[18px] truncate text-[12.5px] leading-[18px] text-muted">{worldLine(world)}</p>
            </div>
          </button>
        )}
        <Button size="sm" variant="ghost" aria-disabled={busy || undefined} aria-label={`Open ${world.name}`} title={isOpen ? 'Back to writing in this world' : 'Open this world where you left off'} onClick={() => void openWorldFromStart(world.id)}>
          Open
        </Button>
        <CardMenu
          label={`More for ${world.name}`}
          items={[
            { label: 'Open', icon: FolderOpen, run: () => void openWorldFromStart(world.id) },
            { label: 'Rename', icon: PenLine, run: () => setRenaming(true), afterClose: true },
            { label: 'Details', icon: Info, run: () => void worldDetails(world.id) },
            { label: 'Export world…', icon: FileDown, run: () => void exportWorld(world.id), apart: true },
            { label: 'Make a copy', icon: Copy, run: () => void copyWorld(world.id).then((made) => void (made && loadLibrary())) },
            { label: 'Delete world…', icon: Trash2, run: () => onDelete(world), danger: true, apart: true, afterClose: true }
          ]}
        />
      </div>
      {expanded ? (
        <ul id={listId} aria-label={`Stories in ${world.name}`} className="border-t border-line px-1.5 py-1.5">
          {stories.length ? (
            stories.map((s) => <StoryRow key={s.id} worldId={world.id} story={s} kind={kinds[s.id] ?? ''} />)
          ) : (
            <li className="flex h-9 items-center pl-[52px] text-[13px] text-faint">No stories in this world yet.</li>
          )}
        </ul>
      ) : null}
    </li>
  )
}

function WorldIcon(): React.JSX.Element {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
      <Globe2 size={17} />
    </span>
  )
}

/** One story in an opened-up world card. */
function StoryRow({ worldId, story, kind }: { worldId: string; story: LibraryStory; kind: string }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  // Another world is being opened or closed from the start screen: opening this one waits (see exclusive).
  const busy = useLibrary((s) => s.busy)
  const row = useRef<HTMLButtonElement>(null)
  const title = story.title.trim() || 'Untitled story'
  const meta = (
    <>
      <span className="w-[130px] shrink-0 truncate text-[12px] text-faint">{kind}</span>
      <span className="w-[90px] shrink-0 text-right text-[12px] tabular-nums text-muted">{wordsText(story.words)}</span>
      <span className="w-[150px] shrink-0 truncate text-right text-[12px] text-faint">{editedText(story.editedAt)}</span>
    </>
  )
  return (
    <li className="flex items-center gap-1 rounded-lg pr-1 hover:bg-surface-2 has-[button:focus-visible]:bg-surface-2">
      {renaming ? (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-3 pl-[44px] pr-2">
          <BookOpen size={14} className="shrink-0 text-muted" />
          <div className="flex min-w-0 flex-1 items-center">
            <InlineTitle
              label="Story title"
              value={story.title}
              className="h-6 text-[13.5px]"
              onCommit={(t) => renameStoryFromStart(worldId, story, t)}
              onDone={() => {
                setRenaming(false)
                focusBack(row.current)
              }}
            />
          </div>
          {meta}
        </div>
      ) : (
        <button
          ref={row}
          type="button"
          aria-label={title}
          aria-disabled={busy || undefined}
          aria-description={[kind, wordsText(story.words), editedText(story.editedAt)].filter(Boolean).join(', ')}
          title="Open this story where you left off"
          onClick={() => void openStoryFromStart(worldId, story.id)}
          className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg pl-[44px] pr-2 text-left outline-none"
        >
          <BookOpen size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{title}</span>
          {meta}
        </button>
      )}
      <CardMenu
        label={`More for ${title}`}
        items={[
          { label: 'Open', icon: FolderOpen, run: () => void openStoryFromStart(worldId, story.id) },
          { label: 'Rename', icon: PenLine, run: () => setRenaming(true), afterClose: true },
          { label: 'Details', icon: Info, run: () => void storyDetails(worldId, story.id) },
          { label: 'Delete story', icon: Trash2, run: () => void deleteStoryFromStart(worldId, story), danger: true, apart: true }
        ]}
      />
    </li>
  )
}
