// When the Check room's story was last checked (polish, 2026-10-21): a check that ends says so in one short line under
// Check this story ("Checked just now · 4 scenes"), so it is clear the check finished. Only checks Adam asked for and
// that ran to the end; kept for the session, per story, and forgotten when another world opens.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { onCheckEnded, useChecks } from '../checkStore'
import type { LastCheck } from './lastCheckWords'

export const useLastCheck = create<{ byStory: Record<ID, LastCheck> }>(() => ({ byStory: {} }))

onCheckEnded((d) => {
  const run = useChecks.getState().run
  // The check Adam asked for (a background check after Mark done has its own note), and only one that finished.
  if (d.background || d.status !== 'complete' || !run) return
  if (d.run && d.run.runId !== run.runId) return
  const scenes = d.run?.total || d.scenes.length || run.total || 0
  useLastCheck.setState((s) => ({ byStory: { ...s.byStory, [run.storyId]: { at: Date.now(), scenes } } }))
})

useApp.subscribe((now, before) => {
  if (now.world?.id !== before.world?.id) useLastCheck.setState({ byStory: {} })
})
