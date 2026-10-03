// The scene toolbar's milestone 4 tools, beside Generate: Variants, Beat by beat, History and Listen
// (the spec's slim toolbar: Generate, Variants, Beat by beat, writer model, History). Each button is
// its own part's file; a part that has nothing to offer right now renders nothing.
import type { ID } from '@shared/types'
import { VariantsButton } from '@/features/variants/VariantsButton'
import { BeatsButton } from '@/features/beats/BeatsButton'
import { HistoryButton } from '@/features/history/HistoryButton'
import { ListenButton } from '@/features/readAloud/ListenButton'
import { SpeakersButton } from '@/features/readAloud/SpeakersButton'

export function SceneTools({ sceneId }: { sceneId: ID }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <VariantsButton sceneId={sceneId} />
      <BeatsButton sceneId={sceneId} />
      <HistoryButton sceneId={sceneId} />
      <ListenButton sceneId={sceneId} />
      <SpeakersButton />
    </div>
  )
}
