// The New look's four areas, down the rail on the left: Write, Plan, World and Check. Which area each screen belongs
// to is this one table, so opening a screen from anywhere (the palette, a link, a shortcut) shows its area on the
// rail, and a new screen is one line here (TypeScript asks for it). Settings sits at the rail's foot, in no area.
import type { View } from '@/lib/store'

export type Area = 'write' | 'plan' | 'world' | 'check'

export const AREAS: { id: Area; label: string; hint: string }[] = [
  { id: 'write', label: 'Write', hint: 'Your story’s chapters and scenes, the style guide and the story’s settings' },
  { id: 'plan', label: 'Plan', hint: 'The outline, each chapter’s plan, ideas for what happens next and the plot threads' },
  { id: 'world', label: 'World', hint: 'Everything in your world, the relationship map and the timeline' },
  { id: 'check', label: 'Check', hint: 'Consistency, what the memory changed, and the issues in a scene' }
]

/** Each screen's area (null: Settings, at the rail's foot, and the desk's story home). */
export const AREA_OF: Record<View['kind'], Area | null> = {
  write: 'write',
  style: 'write',
  story: 'write',
  history: 'write',
  variants: 'write',
  generation: 'write',
  import: 'write',
  outline: 'plan',
  threads: 'plan',
  recipes: 'plan',
  recipePlan: 'plan',
  board: 'plan',
  codex: 'world',
  entries: 'world',
  builder: 'world',
  timeline: 'world',
  map: 'world',
  worldBuilder: 'world',
  consistency: 'check',
  memory: 'check',
  settings: null,
  // The desk's story home belongs to no room (the lamp mark and the story's name open it).
  storyHome: null
}

/** The area a screen belongs to. */
export const areaOf = (view: View): Area | null => AREA_OF[view.kind]
