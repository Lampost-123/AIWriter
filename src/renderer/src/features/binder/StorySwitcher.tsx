import * as M from '@radix-ui/react-dropdown-menu'
import { BookOpen, Check, ChevronsUpDown, PenLine, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { editorBridge } from '@/lib/editorBridge'
import { api } from '@/lib/api'
import { lastSceneOf } from './lastScene'
import * as actions from './actions'
import { InlineTitle } from './InlineTitle'

const item = 'flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2'

/** The open story's title, with a menu to switch stories, start a new one or rename this one. */
export function StorySwitcher(): React.JSX.Element {
  const stories = useApp((s) => s.stories)
  const storyId = useApp((s) => s.storyId)
  const story = stories.find((s) => s.id === storyId) ?? null
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = (id: string): void => {
    if (id === storyId) return
    void (async () => {
      await editorBridge()?.flush()
      // Reopen the scene last open in that story, else its first scene.
      const outline = await api.getOutline(id)
      const remembered = lastSceneOf(id)
      const scene = outline.scenes.find((s) => s.id === remembered) ?? outline.scenes[0] ?? null
      useApp.getState().selectScene(scene?.id ?? null, id)
    })().catch((e: Error) => toast(e.message, { tone: 'danger' }))
  }

  const create = (): void => {
    setBusy(true)
    void actions.newStory().then((id) => {
      setBusy(false)
      if (id) setRenaming(true)
    })
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
      {renaming && story ? (
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2">
          <BookOpen size={14} className="shrink-0 text-muted" />
          <InlineTitle
            label="Story title"
            value={story.title}
            className="h-7 text-[13.5px] font-semibold"
            onCommit={(t) => void actions.renameStory(story.id, t)}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <M.Root modal={false}>
          <M.Trigger
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 data-[state=open]:bg-surface-2"
          >
            <BookOpen size={14} className="shrink-0 text-muted" />
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-semibold', story ? 'text-fg' : 'text-faint')}>
              {story?.title ?? 'No story yet'}
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-faint" />
          </M.Trigger>
          <M.Portal>
            <M.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[240px] max-w-[320px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Stories in this world</M.Label>
              {stories.map((s) => (
                <M.Item key={s.id} onSelect={() => open(s.id)} className={item}>
                  <span className="flex w-4 justify-center">{s.id === storyId ? <Check size={14} className="text-accent" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                </M.Item>
              ))}
              <M.Separator className="my-1 h-px bg-line" />
              {story ? (
                <M.Item onSelect={() => setRenaming(true)} className={item}>
                  <span className="flex w-4 justify-center text-muted">
                    <PenLine size={14} />
                  </span>
                  Rename this story
                </M.Item>
              ) : null}
              <M.Item onSelect={create} disabled={busy} className={cn(item, 'data-[disabled]:opacity-50')}>
                <span className="flex w-4 justify-center text-muted">
                  <Plus size={14} />
                </span>
                New story
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      )}
    </div>
  )
}
