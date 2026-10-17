// The premise the AI wrote first, for a story planned from the plot in the Story builder with no premise of its own
// (2026-10-17): Keep makes it the story's premise (Undo in a toast); it can be changed first, or discarded.

import { useId, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { premiseOf } from '@/features/recipes/recipeLogic'

export function PremiseCard({ storyId, text, ended, onKeep }: { storyId: ID; text: string; ended: boolean; onKeep?: (premise: string) => void }): React.JSX.Element | null {
  const arrived = premiseOf(text, ended)
  const [words, setWords] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const id = useId()
  if (!arrived.text || hidden) return null
  const value = words ?? arrived.text
  const save = async (premise: string): Promise<void> => {
    await api.updateStory(storyId, { premise })
    await useApp.getState().refreshStories()
    onKeep?.(premise)
  }
  return (
    <section aria-label="Suggested premise" className="rounded-xl border border-ai/40 bg-ai-soft p-4" data-premise-card>
      <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Premise</h2>
      <AutoTextarea
        id={id}
        aria-label="Suggested premise"
        value={value}
        minRows={2}
        maxRows={8}
        disabled={!arrived.complete}
        className="mt-1.5 bg-transparent font-serif text-[14.5px]"
        onChange={(e) => setWords(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!arrived.complete || !value.trim()}
          onClick={() =>
            void save(value.trim())
              .then(() => toast('Kept as the story’s premise.', { action: { label: 'Undo', run: () => void save('') } }))
              .catch((e: Error) => toast(e.message, { tone: 'danger' }))
          }
        >
          Keep as the premise
        </Button>
        <Button size="sm" variant="ghost" disabled={!arrived.complete} onClick={() => setHidden(true)}>
          Discard
        </Button>
      </div>
    </section>
  )
}
