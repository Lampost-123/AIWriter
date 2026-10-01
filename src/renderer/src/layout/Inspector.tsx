import type { ID } from '@shared/types'
import { Tabs, TabsContent, TabsList } from '@/components/ui'
import { SceneCardPanel } from '@/features/inspector/SceneCardPanel'
import { GenerationsPanel } from '@/features/generate/GenerationsPanel'

/** The right-hand panel beside a scene. Milestone 2 adds Context and Cast tabs. */
export function Inspector({ sceneId }: { sceneId: ID }): React.JSX.Element {
  return (
    <Tabs defaultValue="card" className="flex h-full min-h-0 flex-col">
      <TabsList
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
