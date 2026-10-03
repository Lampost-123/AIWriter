import * as M from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from '@/components/ui/icons'
import { useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { GenerateControls } from '@/features/generate/GenerateControls'
import * as actions from '@/features/binder/actions'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { useOutline } from '@/features/binder/outlineStore'
import { STATUS_LABELS, STATUSES, StatusDot } from '@/features/binder/StatusDot'
import { changeStatus } from './markDone'
import { DoneButton } from './DoneButton'
import { MemoryNote } from './MemoryNote'
import { SceneTools } from './SceneTools'

function StatusMenu({ sceneId, status }: { sceneId: ID; status: SceneStatus }): React.JSX.Element {
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-label={`Scene status: ${STATUS_LABELS[status]}`}
        title="Scene status"
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line px-2 text-[12px] font-medium text-muted outline-none transition-colors duration-150 hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:border-line-strong data-[state=open]:text-fg @min-[660px]:px-2.5 look-new:h-[30px] look-new:border-transparent look-new:bg-surface look-new:shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <StatusDot status={status} />
        {/* In a narrow header (a small window) the status shows as its dot alone, leaving the room to the scene's title. */}
        <span className="hidden w-[52px] text-left @min-[660px]:inline-block">{STATUS_LABELS[status]}</span>
        <ChevronDown size={12} className="hidden text-faint @min-[660px]:block" />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[160px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {STATUSES.map((s) => (
            <M.Item
              key={s}
              // Done is the same as Mark done; leaving Done reopens the scene.
              onSelect={() => s !== status && void changeStatus(sceneId, status, s)}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="flex w-3 justify-center">
                <StatusDot status={s} />
              </span>
              <span className="flex-1">{STATUS_LABELS[s]}</span>
              {s === status ? <Check size={14} className="text-accent" /> : null}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/**
 * The slim bar above the page: where the scene sits, its title and status, Mark done, and
 * the drafting controls. Fixed height, so nothing below it ever moves.
 */
export function SceneHeader({ sceneId, fallbackTitle, fallbackStatus }: { sceneId: ID; fallbackTitle: string; fallbackStatus: SceneStatus }): React.JSX.Element {
  const { outline } = useOutline()
  const stories = useApp((s) => s.stories)
  const storyId = useApp((s) => s.storyId)
  const [editing, setEditing] = useState(false)

  const meta = outline?.scenes.find((s) => s.id === sceneId)
  const chapter = meta ? outline?.chapters.find((c) => c.id === meta.chapterId) : undefined
  const story = stories.find((s) => s.id === (outline?.story.id ?? storyId))
  const title = meta?.title ?? fallbackTitle
  const status = meta?.status ?? fallbackStatus

  return (
    // Sized by its own width (both side panels change it). As it narrows, the story's name goes first, then the
    // chapter's, then Mark done's words, then the status word, so a scene's title of a few words stays whole (with both
    // side panels open in a 1366-wide window the header is about 740 px: Mark done is then its tick alone).
    // Focus mode (milestone 6) fades it away, keeping its room so the page doesn't move (data-focus-chrome, styles.css).
    // The New look: the scene's title is at the head of the page (PageTitle) and where it sits is in the top bar's trail,
    // so the bar is the scene's tools alone.
    <header data-focus-chrome className="@container flex h-12 shrink-0 items-center gap-3 border-b border-line/70 bg-page pl-5 pr-3 look-new:h-[54px] look-new:gap-2.5 look-new:pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
        {story ? (
          <>
            <span className="hidden min-w-0 max-w-[40%] shrink-[16] truncate text-faint @min-[1040px]:inline look-new:hidden!">{story.title}</span>
            <span className="hidden text-line-strong @min-[1040px]:inline look-new:hidden!">/</span>
          </>
        ) : null}
        {chapter ? (
          <>
            <span className="hidden min-w-0 max-w-[40%] shrink-[16] truncate text-faint @min-[940px]:inline look-new:hidden!">{chapter.title}</span>
            <span className="hidden text-line-strong @min-[940px]:inline look-new:hidden!">/</span>
          </>
        ) : null}
        {editing ? (
          <div className="flex min-w-[120px] flex-1">
            <InlineTitle
              label="Scene title"
              value={title}
              className="h-7 text-[14px] font-semibold"
              onCommit={(t) => actions.renameScene(sceneId, t)}
              onDone={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            title="Rename this scene"
            onClick={() => setEditing(true)}
            className="-mx-1 h-7 min-w-0 shrink truncate rounded-[4px] px-1 text-left text-[14px] font-semibold text-fg outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 @min-[940px]:max-w-[65%] look-new:hidden"
          >
            {title || 'Untitled scene'}
          </button>
        )}
        {meta?.memoryState === 'failed' && !editing ? <MemoryNote sceneId={sceneId} /> : null}
      </div>
      <StatusMenu sceneId={sceneId} status={status} />
      <DoneButton sceneId={sceneId} status={status} />
      <SceneTools sceneId={sceneId} />
      <div className={cn('flex shrink-0 items-center')}>
        <GenerateControls sceneId={sceneId} />
      </div>
    </header>
  )
}
