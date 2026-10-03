// The New story dialog's "From a recipe" part (Story recipes): pick a recipe, add your own guidance, and choose
// whether the story takes the recipe's writing style and themes. Shows nothing while the library has no finished
// recipe, so the dialog of someone who never made one is as it always was. Owned by the Story recipes part.

import { useEffect, useId, useState } from 'react'
import type { ID } from '@shared/types'
import { Select, Textarea } from '@/components/ui'
import { recipeName } from './recipeLogic'
import { listenForRecipes, takeForStory, useRecipes } from './recipeStore'

export interface RecipePick {
  recipeId: ID | null
  guidance: string
  useStyle: boolean
}

export const noRecipe = (): RecipePick => ({ recipeId: null, guidance: '', useStyle: true })

/** The pick the dialog starts with: the recipe "Start a new story from it" asked for, if any. */
export function useRecipePick(): [RecipePick, (p: RecipePick) => void] {
  const [pick, setPick] = useState<RecipePick>(() => ({ ...noRecipe(), recipeId: useRecipes.getState().forStory }))
  useEffect(() => {
    listenForRecipes()
    // Asked for once: the next time the dialog opens, it starts with no recipe.
    takeForStory()
  }, [])
  return [pick, setPick]
}

export function RecipeChoice({ value, onChange }: { value: RecipePick; onChange: (p: RecipePick) => void }): React.JSX.Element | null {
  const id = useId()
  const list = useRecipes((s) => s.list)
  const ready = (list ?? []).filter((r) => r.status === 'ready')
  if (!ready.length && !value.recipeId) return null
  const options = ready.map((r) => ({ value: r.id, label: recipeName(r) }))
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-recipe`} className="text-[12px] font-medium text-muted">
        From a recipe
      </label>
      <Select
        id={`${id}-recipe`}
        value={value.recipeId}
        options={options}
        allowNone
        noneLabel="No recipe"
        onChange={(recipeId) => onChange({ ...value, recipeId })}
      />
      {value.recipeId ? (
        <div className="mt-2 flex flex-col gap-1 animate-fade-in">
          <label htmlFor={`${id}-guidance`} className="text-[12px] font-medium text-muted">
            Your own ideas for it
          </label>
          <Textarea
            id={`${id}-guidance`}
            value={value.guidance}
            minRows={2}
            maxRows={8}
            placeholder="Such as: set it on a space station, and make the mentor the villain."
            onChange={(e) => onChange({ ...value, guidance: e.target.value })}
          />
          <p className="text-[12px] text-faint">
            The AI lays out the story with the recipe’s shape, told your way: where your ideas differ from the recipe, yours win. You keep, change or
            discard each suggestion.
          </p>
          <label className="mt-1 flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={value.useStyle}
              onChange={(e) => onChange({ ...value, useStyle: e.target.checked })}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            Write it in the recipe’s style, with its themes and tone
          </label>
        </div>
      ) : null}
    </div>
  )
}
