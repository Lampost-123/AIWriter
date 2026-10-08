import * as M from '@radix-ui/react-dropdown-menu'
import { BookOpen, Brain, Check, ChevronDown, ChevronsUpDown, FileDown, FileUp, LibraryBig, ListTree, PenLine, Plus, Settings2 } from '@/components/ui/icons'
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
import { useOutline } from './outlineStore'
import { useNewLook } from '@/features/look/look'
import { InlineTitle } from './InlineTitle'

const item = 'flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2'

/**
 * The open story's title, with a menu to switch stories (in reading order, each with its grey line when
 * it doesn't simply continue, and its settings), start a new one (the New story dialog) or rename this one.
 */
export function StorySwitcher({ bar = false, onTitle }: { bar?: boolean; onTitle?: () => void }): React.JSX.Element {
  const stories = useApp((s) => s.stories)
  const storyId = useApp((s) => s.storyId)
  const story = stories.find((s) => s.id === storyId) ?? null
  const labels = useStoryLabels((s) => s.labels)
  const order = useStoryLabels((s) => s.order)
  const shelf = useMemo(() => inShelfOrder(stories, order), [stories, order])
  const [renaming, setRenaming] = useState(false)
  // `bar`: the desk's top bar, where the story is its name in the serif beside the world's, with a chevron.
  const isNew = useNewLook() && !bar
  const { outline } = useOutline()
  const holds = outline && outline.story.id === storyId ? holdsLine(outline.chapters.length, outline.scenes.length) : ''
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
    // The New look: the story is a raised card, its cover beside its title and how much it holds.
    <div
      className={cn(
        'flex items-center gap-1',
        bar ? 'h-8 min-w-0 shrink' : 'h-12 shrink-0 border-b border-line px-2 look-new:h-auto look-new:border-transparent look-new:px-1.5 look-new:pb-2 look-new:pt-1'
      )}
    >
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
          {bar && onTitle ? (
            // The desk: the story's name opens its home; the chevron beside it, the menu.
            <span className="flex min-w-0 items-center">
              <button
                type="button"
                data-story-home
                title="This story’s home: the book, its chapters, where you left off"
                onClick={onTitle}
                className="desk-bar-link flex h-8 min-w-0 items-center rounded-[9px] px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className={cn('block max-w-[300px] truncate font-heading text-[15px] leading-5 text-muted', !story && 'text-faint')}>
                  {story?.title ?? 'No story yet'}
                </span>
              </button>
              <M.Trigger
                data-story-menu
                aria-label="Switch story, or this story’s settings"
                title="Switch story, or this story’s settings"
                className="desk-bar-link -ml-1.5 grid h-8 w-6 shrink-0 place-items-center rounded-[9px] outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <ChevronDown size={12} className="shrink-0 text-faint" />
              </M.Trigger>
            </span>
          ) : (
            <M.Trigger
              data-story-menu
              title={bar ? 'Switch story, or this story’s settings' : undefined}
              className={
                bar
                  ? 'desk-bar-link flex h-8 min-w-0 items-center gap-1.5 rounded-[9px] px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
                  : 'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 data-[state=open]:bg-surface-2 look-new:h-auto look-new:gap-2.5 look-new:rounded-[10px] look-new:bg-surface look-new:p-2 look-new:shadow-e1 look-new:hover:bg-raise look-new:data-[state=open]:bg-raise'
              }
            >
              {bar ? null : <BookOpen size={14} className="shrink-0 text-muted look-new:hidden" />}
              {isNew ? (
                <span
                  aria-hidden
                  className="grid h-[38px] w-[30px] shrink-0 place-items-center rounded-[4px_6px_6px_4px] bg-[linear-gradient(160deg,#2f4e78,#1d304c)] text-[#f3d9a4] shadow-[inset_3px_0_0_rgb(0_0_0/0.25),var(--elev-1)]"
                >
                  <BookOpen size={14} />
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    bar
                      ? 'block max-w-[300px] truncate font-heading text-[15px] leading-5 text-muted'
                      : 'block truncate text-[13.5px] font-semibold look-new:font-heading look-new:text-[14.5px]',
                    story ? (bar ? '' : 'text-fg') : 'text-faint'
                  )}
                >
                  {story?.title ?? 'No story yet'}
                </span>
                {isNew && holds ? <span className="block truncate text-[11.5px] text-faint">{holds}</span> : null}
              </span>
              {bar ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronsUpDown size={13} className="shrink-0 text-faint" />}
            </M.Trigger>
          )}
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

/** "2 chapters · 4 scenes" under the story's title (the New look). */
const holdsLine = (chapters: number, scenes: number): string =>
  `${chapters} ${chapters === 1 ? 'chapter' : 'chapters'} · ${scenes} ${scenes === 1 ? 'scene' : 'scenes'}`
