// Pieces the recipe pages share: the page's kicker, the way back, and the line saying how a recipe being made is
// going (with Cancel, or Try again when it paused). Owned by the Story recipes part.

import { ArrowLeft, CookingPot, Square } from '@/components/ui/icons'
import { useEffect } from 'react'
import type { Recipe } from '@shared/contracts/recipes'
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

/**
 * How a recipe being made is going, with Cancel, or why it paused, with Try again and Cancel. On the library page
 * (no `recipe`) it follows the maker; on a recipe's own page it goes by that recipe's own status and reason, so a
 * paused recipe offers Try again even while another is being made. Nothing when there is nothing to say.
 */
export function MakingCard({ recipe }: { recipe?: Pick<Recipe, 'id' | 'name' | 'status' | 'problem'> }): React.JSX.Element | null {
  const maker = useRecipes((s) => s.maker.running)
  if (recipe?.status === 'ready') return null
  const run = recipe ? (maker?.recipeId === recipe.id ? maker : null) : maker
  const id = recipe?.id ?? run?.recipeId
  if (!id) return null
  const name = recipeName({ name: recipe?.name ?? run?.name ?? '', status: 'making' })
  const paused = recipe ? recipe.status === 'paused' : run?.status === 'paused'
  const problem = (recipe ? recipe.problem : run?.error) ?? 'Making the recipe has paused.'
  const cancel = (): void => void cancelMaking(id, name)
  return (
    <Card className="mt-5 p-4">
      {paused ? (
        <>
          <p className="mb-2 text-[13px] font-medium text-fg">{recipe ? 'Making this recipe has paused' : `Making “${name}” has paused`}</p>
          <ProblemNotice message={problem} onRetry={() => void carryOn(id)} />
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div role="status">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">
              {recipe ? null : <span className="text-muted">{name}: </span>}
              <span className="font-medium text-fg">{run ? makingWords(run) : 'Waiting its turn…'}</span>
            </span>
            <Button size="sm" icon={<Square size={10} fill="currentColor" />} disabled={run?.status === 'stopping'} onClick={cancel}>
              Cancel
            </Button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round((run ? makingShare(run) : 0) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-[12px] text-faint">
            It carries on in the background, and after a restart.{run?.waiting ? ` ${run.waiting} more waiting their turn.` : ''}
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
