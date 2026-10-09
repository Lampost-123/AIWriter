// The New look's trail in the top bar: where Adam is, as story › chapter › scene. Each is a way up: the story to
// its settings, the chapter to its plan, the scene back to its page. Each shows its whole name while the bar has
// room; when it is short of room the story's name gives way first, then the chapter's, and the scene's last (the
// search box gives up its spare width before any of them: see TopBar). In a narrow window the story goes, then the
// chapter, so the scene always shows and nothing in the bar overlaps. A name cut short shows whole on hover.
import { ChevronRight } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { openStorySettings } from '@/features/stories/storyActions'

const crumb =
  'min-w-[4em] max-w-[200px] truncate rounded-md px-1.5 py-0.5 transition-colors duration-(--dur-quick) hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
/**
 * How readily each gives up width: the story's name far sooner than the chapter's, the scene's last of all. Steps this
 * large, as even a fraction of a pixel taken from a name would cut it short with "…".
 */
const STORY_GIVES = 'shrink-[1e10]'
const CHAPTER_GIVES = 'shrink-[1e5]'

export function Trail(): React.JSX.Element | null {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const writing = useApp((s) => s.view.kind === 'write')
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const { outline } = useOutline()
  if (!story || !storyId) return null
  const scene = outline?.scenes.find((s) => s.id === sceneId) ?? null
  const chapterIndex = scene && outline ? outline.chapters.findIndex((c) => c.id === scene.chapterId) : -1
  const chapter = chapterIndex >= 0 ? outline!.chapters[chapterIndex] : null
  const sep = <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
  const storyName = story.title.trim() || 'Untitled story'
  const chapterName = chapter ? chapter.title.trim() || `Chapter ${chapterIndex + 1}` : ''
  const sceneName = scene ? scene.title.trim() || 'Untitled scene' : ''
  return (
    <nav aria-label="Where you are" className="flex min-w-0 shrink items-center gap-0.5 text-[13px] text-faint">
      <span className="contents max-[1240px]:hidden">
        <button type="button" className={cn(crumb, STORY_GIVES)} title={`${storyName}: story settings`} onClick={() => openStorySettings(story.id)}>
          {storyName}
        </button>
        {scene ? sep : null}
      </span>
      {chapter ? (
        <span className="contents max-[1080px]:hidden">
          <button
            type="button"
            className={cn(crumb, CHAPTER_GIVES)}
            title={`${chapterName}: plan this chapter`}
            onClick={() => useApp.getState().navigate({ kind: 'outline', storyId, chapterId: chapter.id })}
          >
            {chapterName}
          </button>
          {sep}
        </span>
      ) : null}
      {scene ? (
        <button
          type="button"
          aria-current={writing ? 'page' : undefined}
          title={sceneName}
          className={cn(crumb, writing && 'font-semibold text-fg')}
          onClick={() => useApp.getState().navigate({ kind: 'write' })}
        >
          {sceneName}
        </button>
      ) : null}
    </nav>
  )
}
