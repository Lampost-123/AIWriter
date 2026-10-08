// Opening the desk's story home: the lamp mark and the story's name in the top bar. With no story yet, the start screen.
import { useApp } from '@/lib/store'
import { goToStartScreen } from '@/features/start/home'

export function openStoryHome(): void {
  const app = useApp.getState()
  if (app.storyId) app.navigate({ kind: 'storyHome', storyId: app.storyId })
  else goToStartScreen()
}
