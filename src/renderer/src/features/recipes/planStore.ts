// A new story from a recipe, while the app is open: for each story planned from one, the recipe, Adam's guidance
// and what he decided about the suggested premise. The suggestions themselves (acts, chapters, scene cards) live
// in the outline helper's own session for the story (features/outline/helperStore.ts), so keeping, editing,
// discarding and their Undo work exactly as they do there. Owned by the Story recipes part.

import { create } from 'zustand'
import type { OutlineSize } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { suggestOutlineWith } from '@/features/outline/helperStore'

export interface PlanSession {
  recipeId: ID
  guidance: string
  /** The premise suggested: open, kept (as the story's premise), or discarded. Adam's own words when he edited it. */
  premise: { status: 'open' | 'kept' | 'discarded'; text: string | null; before: string | null; taskId: ID | null }
}

export const usePlans = create<{ plans: Record<string, PlanSession> }>(() => ({ plans: {} }))

const keyOf = (storyId: ID): string => `${useApp.getState().world?.id ?? ''}:${storyId}`
export const planKey = keyOf

export function planOf(storyId: ID): PlanSession | null {
  return usePlans.getState().plans[keyOf(storyId)] ?? null
}

export function patchPlan(storyId: ID, patch: Partial<PlanSession>): void {
  const key = keyOf(storyId)
  usePlans.setState((s) => {
    const was = s.plans[key]
    if (!was && !patch.recipeId) return s
    const base: PlanSession = was ?? { recipeId: '', guidance: '', premise: { status: 'open', text: null, before: null, taskId: null } }
    return { plans: { ...s.plans, [key]: { ...base, ...patch } } }
  })
}

/**
 * After Create in the New story dialog: the recipe's writing style goes into the story's style guide and its
 * themes and tone into the story's (when Adam left that ticked; Undo in the toast), then the plan page opens
 * and the AI starts laying the story out.
 */
export async function startFromRecipe(o: { storyId: ID; recipeId: ID; guidance: string; useStyle: boolean; size: OutlineSize }): Promise<void> {
  patchPlan(o.storyId, { recipeId: o.recipeId, guidance: o.guidance, premise: { status: 'open', text: null, before: null, taskId: null } })
  if (o.useStyle) {
    try {
      const before = await api.applyRecipeToStory(o.storyId, o.recipeId)
      await useApp.getState().refreshStories()
      toast('The new story has the recipe’s writing style, themes and tone. Change them in its settings.', {
        action: {
          label: 'Undo',
          run: () =>
            void api
              .unapplyRecipe(before)
              .then(() => useApp.getState().refreshStories())
              .catch((e) => toast(plainReason(e), { tone: 'danger' }))
        }
      })
    } catch (e) {
      toast(plainReason(e), { tone: 'danger' })
    }
  }
  useApp.getState().navigate({ kind: 'recipePlan', storyId: o.storyId, recipeId: o.recipeId })
  await suggestPlan(o.storyId, o.size)
}

/** Asks the AI to lay out the story from the recipe and the guidance as they are now. */
export async function suggestPlan(storyId: ID, size: OutlineSize): Promise<void> {
  const plan = planOf(storyId)
  if (!plan) return
  await suggestOutlineWith(storyId, size, async (taskId) => {
    const out = await api.startRecipeStory({ taskId, storyId, recipeId: plan.recipeId, guidance: plan.guidance, size })
    patchPlan(storyId, { premise: { status: 'open', text: null, before: null, taskId } })
    return out
  })
}

/** Keeps the suggested premise as the story's own (Undo puts back what it had). */
export async function keepPremise(storyId: ID, text: string): Promise<void> {
  const story = useApp.getState().stories.find((s) => s.id === storyId)
  const before = story?.premise ?? ''
  try {
    await api.updateStory(storyId, { premise: text })
    await useApp.getState().refreshStories()
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  const was = planOf(storyId)?.premise
  patchPlan(storyId, { premise: { status: 'kept', text, before, taskId: was?.taskId ?? null } })
  toast('Kept the premise for the story.', {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .updateStory(storyId, { premise: before })
          .then(() => useApp.getState().refreshStories())
          .then(() => patchPlan(storyId, { premise: { status: 'open', text, before: null, taskId: was?.taskId ?? null } }))
          .catch((e) => toast(plainReason(e), { tone: 'danger' }))
    }
  })
}

export function discardPremise(storyId: ID): void {
  const was = planOf(storyId)?.premise
  if (!was) return
  patchPlan(storyId, { premise: { ...was, status: 'discarded' } })
  toast('Discarded the premise.', { action: { label: 'Undo', run: () => patchPlan(storyId, { premise: { ...was, status: 'open' } }) } })
}

export function editPremise(storyId: ID, text: string): void {
  const was = planOf(storyId)?.premise
  if (was) patchPlan(storyId, { premise: { ...was, text } })
}
