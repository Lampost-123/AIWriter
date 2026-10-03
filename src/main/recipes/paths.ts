// Where the recipe library lives (spec, "Story recipes"): a Recipes folder inside the library folder (default
// Documents/AI Write/Recipes), beside the worlds and never one of them. It holds no world.db, so the library's
// world list, the usage page's list of worlds and world files never see it; slugify() never names a world's
// folder "Recipes", so a world can't take its place. A library that already has a world in a folder called
// Recipes (made before story recipes) keeps its recipes in "Story recipes" instead. No Electron imports.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const RECIPES_FOLDER = 'Recipes'
/** Only when a world already lives in <library>/Recipes. */
export const RECIPES_FALLBACK = 'Story recipes'

/** The recipe library's folder for this library. */
export function recipesDir(library: string): string {
  const main = join(library, RECIPES_FOLDER)
  return existsSync(join(main, 'world.db')) ? join(library, RECIPES_FALLBACK) : main
}

/** True for a folder name in the library that holds recipes, never a world. */
export const isRecipesFolder = (name: string): boolean => /^(recipes|story recipes)$/i.test(name.trim())
