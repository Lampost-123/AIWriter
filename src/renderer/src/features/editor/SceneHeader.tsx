import * as M from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { GenerateControls } from '@/features/generate/GenerateControls'
import * as actions from '@/features/binder/actions'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { useOutline } from '@/features/binder/outlineStore'
import { STATUS_LABELS, STATUSES, StatusDot } from '@/features/binder/StatusDot'

function StatusMenu({ sceneId, status }: { sceneId: ID; status: SceneStatus }): React.JSX.Element {
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-label={`Scene status: ${STATUS_LABELS[status]}`}
        title="Scene status"
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px] font-medium text-muted outline-none transition-colors duration-150 hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:border-line-strong data-[state=open]:text-fg"
      >
        <StatusDot status={status} />
        <span className="w-[52px] text-left">{STATUS_LABELS[status]}</span>
        <ChevronDown size={12} className="text-faint" />
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
              onSelect={() => s !== status && void actions.setSceneStatus(sceneId, s)}
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
 * The slim bar above the page: where the scene sits, its title and status, and
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
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line/70 bg-page pl-5 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
        {story ? (
          <>
            <span className="hidden max-w-[22%] shrink truncate text-faint lg:inline">{story.title}</span>
            <span className="hidden text-line-strong lg:inline">/</span>
          </>
        ) : null}
        {chapter ? (
          <>
            <span className="max-w-[28%] shrink truncate text-faint">{chapter.title}</span>
            <span className="text-line-strong">/</span>
          </>
        ) : null}
        {editing ? (
          <div className="flex min-w-[120px] flex-1">
            <InlineTitle
              label="Scene title"
              value={title}
              className="h-7 text-[14px] font-semibold"
              onCommit={(t) => void actions.renameScene(sceneId, t)}
              onDone={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            title="Rename this scene"
            onClick={() => setEditing(true)}
            className="-mx-1 h-7 min-w-0 shrink truncate rounded-[4px] px-1 text-left text-[14px] font-semibold text-fg outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {title || 'Untitled scene'}
          </button>
        )}
      </div>
      <StatusMenu sceneId={sceneId} status={status} />
      <div className={cn('flex shrink-0 items-center')}>
        <GenerateControls sceneId={sceneId} />
      </div>
    </header>
  )
}
