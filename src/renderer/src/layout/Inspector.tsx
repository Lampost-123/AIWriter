import type { ID } from '@shared/types'
import { Tabs, TabsContent, TabsList } from '@/components/ui'
import { useApp, type InspectorTab } from '@/lib/store'
import { SceneCardPanel } from '@/features/inspector/SceneCardPanel'
import { GenerationsPanel } from '@/features/generate/GenerationsPanel'

/** The right-hand panel beside a scene. Milestone 2 adds Context and Cast tabs. */
export function Inspector({ sceneId }: { sceneId: ID }): React.JSX.Element {
  // Kept in the store, so coming back from "What the AI saw" shows the Drafts tab again.
  const tab = useApp((s) => s.inspectorTab)
  const setTab = useApp((s) => s.setInspectorTab)
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as InspectorTab)} className="flex h-full min-h-0 flex-col">
      <TabsList
        tall
        items={[
          { value: 'card', label: 'Scene card' },
          { value: 'drafts', label: 'Drafts' }
        ]}
      />
      <TabsContent value="card" className="overflow-auto">
        <SceneCardPanel key={sceneId} sceneId={sceneId} />
      </TabsContent>
      <TabsContent value="drafts" className="overflow-auto">
        <GenerationsPanel key={sceneId} sceneId={sceneId} />
      </TabsContent>
    </Tabs>
  )
}
