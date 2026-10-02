import { useEffect, useRef } from 'react'
import type { ID } from '@shared/types'
import { Tabs, TabsContent, TabsList } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp, type InspectorTab } from '@/lib/store'
import { SceneCardPanel } from '@/features/inspector/SceneCardPanel'
import { ContextPanel } from '@/features/context/ContextPanel'
import { CastPanel } from '@/features/cast/CastPanel'
import { GenerationsPanel } from '@/features/generate/GenerationsPanel'
import { PeekPanel } from '@/features/peek/PeekPanel'

const TAB_LABELS: Record<InspectorTab, string> = { card: 'Scene card', context: 'Context', cast: 'Cast', drafts: 'Drafts' }
const TABS: InspectorTab[] = ['card', 'context', 'cast', 'drafts']

/**
 * The right-hand panel beside a scene: its card, the briefing a draft would get, who is in it, and
 * its drafts. An entry shown beside the page (Ctrl+click on a name, or the Cast tab) takes the
 * panel's place until Back; the tabs stay as they were underneath.
 */
export function Inspector({ sceneId }: { sceneId: ID }): React.JSX.Element {
  // Kept in the store, so coming back from "What the AI saw" shows the Drafts tab again.
  const tab = useApp((s) => s.inspectorTab)
  const setTab = useApp((s) => s.setInspectorTab)
  const peekId = useApp((s) => s.peekEntryId)
  const rootRef = useRef<HTMLDivElement>(null)

  const back = (): void => {
    const wasInside = !!rootRef.current?.contains(document.activeElement)
    useApp.getState().peekEntry(null)
    // From the panel's own Back, the keyboard carries on from the tab it returns to.
    if (wasInside) requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus())
  }

  // Something asked for a tab (a new draft shows its Drafts tab): it shows instead of the entry.
  const lastTab = useRef(tab)
  useEffect(() => {
    if (lastTab.current === tab) return
    lastTab.current = tab
    if (useApp.getState().peekEntryId) useApp.getState().peekEntry(null)
  }, [tab])

  return (
    <div ref={rootRef} className="@container h-full min-h-0">
      {peekId ? <PeekPanel sceneId={sceneId} entryId={peekId} backLabel={TAB_LABELS[tab]} onBack={back} /> : null}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as InspectorTab)}
        // Hidden, not unmounted, while an entry shows, so Back finds the tab as it was.
        className={cn('h-full min-h-0 flex-col', peekId ? 'hidden' : 'flex')}
      >
        <TabsList
          tall
          // Four tabs fit the panel at its narrowest (260 px) with a little less room around each.
          className="px-1! *:px-1.5 @min-[300px]:px-2! @min-[300px]:*:px-2.5"
          items={TABS.map((value) => ({ value, label: TAB_LABELS[value] }))}
        />
        <TabsContent value="card" className="overflow-auto">
          <SceneCardPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="context" className="overflow-auto">
          <ContextPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="cast" className="overflow-auto">
          <CastPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="drafts" className="overflow-auto">
          <GenerationsPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
