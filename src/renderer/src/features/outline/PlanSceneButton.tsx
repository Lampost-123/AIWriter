// "Plan this scene" on the scene card (2026-10-19, no dead ends): offered while the card has nothing on it, beside Ideas
// for this scene and Interview me. One click asks the outline helper for this scene's card and fills the card's empty
// parts, with Undo in the toast (scenePlanStore.ts). While it plans, it says so, with Stop; a problem says why, with
// Try again. Whether it is offered is settled when the card opens, so it never vanishes under Adam's first word; it goes
// once a plan has filled the card.
import { useState } from 'react'
import type { ID, SceneCard } from '@shared/types'
import { Sparkles, Square } from '@/components/ui/icons'
import { useApp } from '@/lib/store'
import { WritingStatus } from '@/features/builder/parts'
import { cardIsEmpty } from './ideasLogic'
import { dismissScenePlan, planScene, scenePlanKey, stopScenePlan, useScenePlans } from './scenePlanStore'

const quiet =
  '-mx-1.5 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'

export function PlanSceneButton({ sceneId, card }: { sceneId: ID; card: SceneCard }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const plan = useScenePlans((s) => s.plans[scenePlanKey(worldId, sceneId)] ?? null)
  // Offered for a card empty when it opened (the panel is made again for each scene).
  const [offered, setOffered] = useState(() => cardIsEmpty(card))
  const [planned, setPlanned] = useState(false)
  // Once a plan has filled the card the offer goes; its Undo empties the card again, and the offer comes back.
  const planIt = async (): Promise<void> => {
    const out = await planScene(sceneId)
    if (out.status !== 'filled') return
    setOffered(false)
    setPlanned(true)
  }
  if (plan?.status === 'running') {
    return (
      <span className="flex min-w-0 items-center gap-2" data-plan-scene="running">
        <WritingStatus text="Planning this scene…" />
        <button type="button" className={quiet} onClick={() => stopScenePlan(sceneId)} title="Stop. Nothing on the card changes.">
          <Square size={9} fill="currentColor" aria-hidden />
          Stop
        </button>
      </span>
    )
  }
  if (plan?.status === 'error') {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" role="alert" data-plan-scene="error">
        <span className="text-[12.5px] text-danger">{plan.error}</span>
        <button type="button" className={quiet} onClick={() => void planIt()}>
          Try again
        </button>
        <button type="button" className={quiet} onClick={() => dismissScenePlan(sceneId)}>
          Close
        </button>
      </span>
    )
  }
  if (!offered && !(planned && cardIsEmpty(card))) return null
  return (
    <button
      type="button"
      data-plan-scene
      onClick={() => void planIt()}
      title="The AI plans this scene from the outline around it: what happens, its beats, who is there, where and when. It fills only what is empty."
      className={quiet}
    >
      <Sparkles size={14} className="shrink-0 text-ai" aria-hidden />
      Plan this scene
    </button>
  )
}
