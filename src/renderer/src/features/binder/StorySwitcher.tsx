import * as M from '@radix-ui/react-dropdown-menu'
import { BookOpen, Brain, Check, ChevronsUpDown, FileDown, FileUp, LibraryBig, ListTree, PenLine, Plus, Settings2 } from '@/components/ui/icons'
import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { installFlowEvents } from '@/features/stories/flows'
import { useStoryLabels, useStoryLabelsLoader } from '@/features/stories/labels'
import { openStory, openStorySettings } from '@/features/stories/storyActions'
import { openOutlineHelper } from '@/features/outline/open'
import { currentChapterId, openExportBible, openExportStory } from '@/features/transfer/exportStore'
import { inShelfOrder } from '@/features/stories/storiesLogic'
import { canBuildMemory, offerMemory, startImport, useImport } from '@/features/importing/importStore'
import * as actions from './actions'
import { InlineTitle } from './InlineTitle'

const item = 'flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2'

/**
 * The open story's title, with a menu to switch stories (in reading order, each with its grey line when
 * it doesn't simply continue, and its settings), start a new one (the New story dialog) or rename this one.
 */
export function StorySwitcher(): React.JSX.Element {
  const stories = useApp((s) => s.stories)
  const storyId = useApp((s) => s.storyId)
  const story = stories.find((s) => s.id === storyId) ?? null
  const labels = useStoryLabels((s) => s.labels)
  const order = useStoryLabels((s) => s.order)
  const shelf = useMemo(() => inShelfOrder(stories, order), [stories, order])
  const [renaming, setRenaming] = useState(false)
  // Milestone 6: the story has scenes the memory hasn't read since they were imported.
  const unread = useImport((s) => canBuildMemory(s.catchUp, storyId))
  useStoryLabelsLoader()
  // The story flows report how they are doing from the background; listen from the start.
  useEffect(() => installFlowEvents(), [])

  const open = (id: string): void => {
    if (id === storyId) return
    // Reopens the scene last open in that story, else its first scene.
    openStory(id).catch((e: Error) => toast(e.message, { tone: 'danger' }))
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
      {renaming && story ? (
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2">
          <BookOpen size={14} className="shrink-0 text-muted" />
          <InlineTitle
            label="Story title"
            value={story.title}
            className="h-7 text-[13.5px] font-semibold"
            onCommit={(t) => actions.renameStory(story.id, t)}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <M.Root modal={false}>
          <M.Trigger
            data-story-menu
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 data-[state=open]:bg-surface-2"
          >
            <BookOpen size={14} className="shrink-0 text-muted" />
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-semibold', story ? 'text-fg' : 'text-faint')}>
              {story?.title ?? 'No story yet'}
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-faint" />
          </M.Trigger>
          <M.Portal>
            {/* The stories scroll between the heading and the actions, so "New story…" is always in view. */}
            <M.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 flex max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] w-[380px] max-w-[calc(100vw-16px)] flex-col rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Label className="shrink-0 px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                Stories in this world
              </M.Label>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {shelf.map((s) => {
                  const title = s.title.trim() || 'Untitled story'
                  return (
                    <div key={s.id} className="group/row flex items-stretch gap-0.5">
                      <M.Item onSelect={() => open(s.id)} className={cn(item, 'h-auto min-h-8 min-w-0 flex-1 items-start py-1.5')}>
                        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                          {s.id === storyId ? <Check size={14} className="text-accent" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate leading-5">{title}</span>
                          {labels[s.id] ? <span className="line-clamp-2 text-[12px] leading-4 text-faint">{labels[s.id]}</span> : null}
                        </span>
                      </M.Item>
                      <M.Item
                        onSelect={() => openStorySettings(s.id)}
                        aria-label={`Settings for ${title}`}
                        title="Story settings"
                        className="flex w-8 shrink-0 items-center justify-center rounded-md text-faint opacity-0 outline-none transition-opacity duration-150 group-hover/row:opacity-100 data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg data-[highlighted]:opacity-100"
                      >
                        <Settings2 size={14} />
                      </M.Item>
                    </div>
                  )
                })}
              </div>
              <M.Separator className="my-1 h-px shrink-0 bg-line" />
              {story ? (
                <>
                  <M.Item onSelect={() => openStorySettings(story.id)} className={cn(item, 'shrink-0')}>
                    <span className="flex w-4 justify-center text-muted">
                      <Settings2 size={14} />
                    </span>
                    Story settings
                  </M.Item>
                  <M.Item onSelect={() => setRenaming(true)} className={cn(item, 'shrink-0')}>
                    <span className="flex w-4 justify-center text-muted">
                      <PenLine size={14} />
                    </span>
                    Rename this story
                  </M.Item>
                  <M.Item onSelect={() => openOutlineHelper(story.id)} className={cn(item, 'shrink-0')}>
                    <span className="flex w-4 justify-center text-muted">
                      <ListTree size={14} />
                    </span>
                    Outline helper
                  </M.Item>
                  <M.Item onSelect={() => openExportStory(story.id, currentChapterId())} className={cn(item, 'shrink-0')}>
                    <span className="flex w-4 justify-center text-muted">
                      <FileDown size={14} />
                    </span>
                    Export story…
                  </M.Item>
                  <M.Item onSelect={() => openExportBible(story.id)} className={cn(item, 'shrink-0')}>
                    <span className="flex w-4 justify-center text-muted">
                      <LibraryBig size={14} />
                    </span>
                    Export series bible…
                  </M.Item>
                  {unread ? (
                    <M.Item onSelect={() => offerMemory(story.id)} className={cn(item, 'shrink-0')}>
                      <span className="flex w-4 justify-center text-muted">
                        <Brain size={14} />
                      </span>
                      Build the memory from this story
                    </M.Item>
                  ) : null}
                </>
              ) : null}
              <M.Item onSelect={() => useApp.getState().setNewStoryOpen(true)} className={cn(item, 'shrink-0')}>
                <span className="flex w-4 justify-center text-muted">
                  <Plus size={14} />
                </span>
                New story…
              </M.Item>
              <M.Item onSelect={() => startImport()} className={cn(item, 'shrink-0')}>
                <span className="flex w-4 justify-center text-muted">
                  <FileUp size={14} />
                </span>
                Import a manuscript…
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      )}
    </div>
  )
}
