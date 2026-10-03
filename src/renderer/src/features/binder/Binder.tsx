import { Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { useApp } from '@/lib/store'
import { CheckLine } from '@/features/consistency/CheckLine'
import { rememberScene } from './lastScene'
import { useOutline } from './outlineStore'
import { StorySwitcher } from './StorySwitcher'
import { StoryTree } from './StoryTree'
import { WorldSection } from './WorldSection'

/** True once `on` has stayed true for `ms`, so quick loads never flash a placeholder. */
function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!on) {
      setShown(false)
      return
    }
    const t = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && shown
}

function TreeSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="space-y-1 px-3 pt-2 animate-fade-in">
      {[62, 0, 0, 0, 54, 0, 0].map((w, i) => (
        <div key={i} className="flex h-8 items-center gap-2" style={{ paddingLeft: w ? 4 : 26 }}>
          <div className="h-2.5 rounded-full bg-surface-3" style={{ width: w ? `${w}%` : `${40 + ((i * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  )
}

/** The left panel: story switcher, the story's chapters and scenes, and the world section. */
export function Binder(): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const { outline, error, retry } = useOutline()
  const slow = useDelayed(!!storyId && !outline && !error, 300)

  useEffect(() => {
    if (storyId && sceneId) rememberScene(storyId, sceneId)
  }, [storyId, sceneId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StorySwitcher />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {outline ? (
          <StoryTree outline={outline} />
        ) : error ? (
          <div className="px-4 py-8 text-center animate-fade-in">
            <p className="text-[13px] font-medium text-fg">The chapters couldn’t be loaded</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{error}</p>
            <Button size="sm" className="mt-3" icon={<RotateCcw size={13} />} onClick={retry}>
              Try again
            </Button>
          </div>
        ) : !storyId ? (
          <div className="flex flex-col items-center px-4 py-10 text-center animate-fade-in">
            <p className="text-[13px] font-medium text-fg">No stories yet</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">A story holds its chapters and scenes. Every story in this world shares its characters, places and lore.</p>
            <Button size="sm" className="mt-3" icon={<Plus size={14} />} onClick={() => useApp.getState().setNewStoryOpen(true)}>
              New story…
            </Button>
          </div>
        ) : slow ? (
          <TreeSkeleton />
        ) : null}
      </div>
      {/* Milestone 5: a check running, quietly, with Stop. */}
      <CheckLine />
      <WorldSection />
    </div>
  )
}
