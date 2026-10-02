// Ways into the World builder page: the binder's World section, the command palette, the empty codex and
// a new world ("Build from a summary" beside "Create world"). Owned by the World builder part.

import { useApp } from '@/lib/store'

/** Opens the World builder page (Build the world from a summary) in the open world. */
export function openWorldBuilder(): void {
  useApp.getState().navigate({ kind: 'worldBuilder' })
}

/** Makes a new world and opens the World builder in it, so Adam can start it from a summary. */
export async function createWorldAndBuild(name: string): Promise<void> {
  await useApp.getState().createWorld(name)
  openWorldBuilder()
}
