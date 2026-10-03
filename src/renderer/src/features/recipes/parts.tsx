// Pieces the recipe pages share: the page's kicker, the way back, and the line saying how a recipe being made is
// going (with Cancel, or Try again when it paused). Owned by the Story recipes part.

import { ArrowLeft, CookingPot, Square } from 'lucide-react'
import { useEffect } from 'react'
import { Button, Card } from '@/components/ui'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import { makingShare, makingWords, recipeName } from './recipeLogic'
import { cancelMaking, carryOn, listenForRecipes, openRecipes, useRecipes } from './recipeStore'

export const INTRO = 'A recipe is the story’s themes, writing style and structure, without its words.'

export function Kicker(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
      <CookingPot size={12} aria-hidden />
      Story recipes
    </div>
  )
}

export function BackButton({ to }: { to: 'writing' | 'library' }): React.JSX.Element {
  const hasWorld = useApp((s) => !!s.world)
  return (
    <div className="mb-4 h-7">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft size={14} />}
        className="-ml-2.5"
        onClick={() => (to === 'library' ? openRecipes() : useApp.getState().navigate({ kind: 'write' }))}
      >
        {to === 'library' ? 'Back to the recipe library' : hasWorld ? 'Back to writing' : 'Back'}
      </Button>
    </div>
  )
}

/** The recipe being made (or paused): how far it has got, with Cancel or Try again. Nothing when there is none. */
export function MakingCard({ recipeId }: { recipeId?: string }): React.JSX.Element | null {
  const run = useRecipes((s) => s.maker.running)
  if (!run || (recipeId && run.recipeId !== recipeId)) return null
  const name = recipeName({ name: run.name, status: 'making' })
  return (
    <Card className="mt-5 p-4">
      {run.status === 'paused' ? (
        <>
          <p className="mb-2 text-[13px] font-medium text-fg">{recipeId ? 'Making this recipe has paused' : `Making “${name}” has paused`}</p>
          <ProblemNotice message={run.error ?? 'Making the recipe has paused.'} onRetry={() => void carryOn(run.recipeId)} />
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={() => void cancelMaking(run.recipeId, name)}>
              Cancel this recipe
            </Button>
          </div>
        </>
      ) : (
        <div role="status">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">
              {recipeId ? null : <span className="text-muted">{name}: </span>}
              <span className="font-medium text-fg">{makingWords(run)}</span>
            </span>
            <Button size="sm" icon={<Square size={10} fill="currentColor" />} disabled={run.status === 'stopping'} onClick={() => void cancelMaking(run.recipeId, name)}>
              Cancel
            </Button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(makingShare(run) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-[12px] text-faint">
            It carries on in the background, and after a restart.{run.waiting ? ` ${run.waiting} more waiting their turn.` : ''}
          </p>
        </div>
      )}
    </Card>
  )
}


/** Mounted once: follows the recipe library from the start, so a recipe that finishes says so wherever Adam is. */
export function RecipeWatch(): null {
  useEffect(() => listenForRecipes(), [])
  return null
}
