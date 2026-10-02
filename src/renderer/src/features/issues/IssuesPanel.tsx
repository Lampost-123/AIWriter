import type { ID } from '@shared/types'

/** The Issues tab beside a scene (milestone 5, AI checks part). Groundwork placeholder. */
export function IssuesPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  return <div data-scene={sceneId} />
}
