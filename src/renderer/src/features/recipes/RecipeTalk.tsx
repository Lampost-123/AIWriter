// Talking a recipe over, and writing one part again (the Story builder and the recipe page, 2026-10-17). The talk's
// changed parts wait as a before-and-after preview (talkStore.ts) for Apply or Decline; a part done again shows its new
// words for Use this or Keep mine. Where Apply and Use put the words is the page's own: the Story builder keeps them
// for its story only, the recipe page saves them to the recipe.

import { useState } from 'react'
import { RotateCcw, Square } from '@/components/ui/icons'
import type { RecipePartId, RecipeParts } from '@shared/contracts/recipes'
import type { ID } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from '@/features/planning/LampThinking'
import { TalkPanel } from '@/features/planning/TalkPanel'
import { say, useTalks } from '@/features/planning/talkStore'

export const PART_LABELS: Record<RecipePartId, string> = {
  themes: 'Themes',
  tone: 'Tone',
  pov: 'Point of view',
  tense: 'Tense',
  style: 'Writing style',
  sample: 'Sample passage',
  shape: 'Shape',
  beats: 'Beats',
  cast: 'Cast roles',
  pacing: 'Pacing',
  devices: 'Devices',
  feel: 'Genre and content'
}

/** Says something about a recipe; changed parts wait as the preview. */
export function talkParts(scope: string, parts: () => RecipeParts | null, message: string): Promise<void> {
  return say(scope, message, async (taskId, history) => {
    const p = parts()
    if (!p) throw new Error('Choose a recipe first.')
    const r = await api.recipeChat({ taskId, parts: p, history, message })
    if (r.status === 'stopped') return null
    if (r.status === 'error') throw new Error(r.error ?? 'That didn’t work. Please try again.')
    return { answer: r.answer, revision: r.parts }
  })
}

function PartsPreview({ before, after }: { before: RecipeParts | null; after: Partial<RecipeParts> }): React.JSX.Element {
  return (
    <div className="flex max-h-[340px] flex-col gap-3 overflow-y-auto pr-1">
      {(Object.keys(after) as RecipePartId[]).map((k) => (
        <div key={k}>
          <p className="text-[11.5px] font-semibold text-muted">{PART_LABELS[k]}</p>
          {before?.[k]?.trim() ? <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-faint line-through decoration-faint/60">{before[k]}</p> : null}
          <p className="mt-0.5 whitespace-pre-wrap rounded bg-ai-soft px-2 py-1 text-[12.5px] leading-relaxed text-fg">{after[k]}</p>
        </div>
      ))}
    </div>
  )
}

export function RecipeTalkPanel({
  scope,
  parts,
  onSay,
  onApply,
  onDecline,
  intro,
  className
}: {
  scope: string
  parts: RecipeParts | null
  onSay: (message: string) => void
  onApply: () => void
  onDecline: () => void
  intro: string
  className?: string
}): React.JSX.Element {
  const preview = useTalks((s) => s.talks[scope]?.preview) as Partial<RecipeParts> | null | undefined
  return (
    <TalkPanel
      scope={scope}
      title="Talk the recipe over"
      className={className}
      intro={intro}
      placeholder="What would you like changed?"
      quick={['Make it darker', 'Give it a faster pace', 'Add a twist at the midpoint', 'Fewer characters']}
      onSay={onSay}
      preview={preview ? <PartsPreview before={parts} after={preview} /> : null}
      onApply={onApply}
      onDecline={onDecline}
    />
  )
}

/** "Redo" on one part: a note, then the new words for Use this or Keep mine. */
export function PartRedo({ parts, part, onUse }: { parts: RecipeParts; part: RecipePartId; onUse: (text: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [task, setTask] = useState<ID | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    const taskId = crypto.randomUUID()
    setTask(taskId)
    setText('')
    setError(null)
    try {
      const r = await api.redoRecipePart({ taskId, parts, part, note })
      if (r.status === 'complete') setText(r.text)
      else if (r.status === 'error') setError(r.error ?? 'That didn’t work. Please try again.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTask((t) => (t === taskId ? null : t))
    }
  }
  const close = (): void => {
    if (task) void api.stopTask(task).catch(() => undefined)
    setOpen(false)
    setNote('')
    setText('')
    setError(null)
    setTask(null)
  }
  if (!open) {
    return (
      <button type="button" className="rounded px-1.5 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:bg-ai/10 hover:text-fg" onClick={() => setOpen(true)} data-part-redo={part}>
        Redo
      </button>
    )
  }
  return (
    <div className="mt-2 w-full rounded-lg border border-ai/40 bg-surface p-3 animate-fade-in">
      {!text ? (
        <>
          <AutoTextarea
            aria-label="What should be different"
            value={note}
            minRows={1}
            maxRows={4}
            autoFocus
            placeholder="What should be different? Leave empty for a fresh take."
            className="text-[13px]"
            disabled={!!task}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !task) {
                e.preventDefault()
                void run()
              } else if (e.key === 'Escape') close()
            }}
          />
          {error ? (
            <div className="mt-2">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            {task ? (
              <>
                <LampStatus text="Writing it again…" />
                <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={close}>
                  Stop
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button size="sm" variant="ai" icon={<RotateCcw size={13} />} onClick={() => void run()}>
                  Write it again
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap rounded bg-ai-soft px-2.5 py-2 text-[13px] leading-relaxed text-fg">{text}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Keep mine
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void run()} disabled={!!task}>
              Again
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onUse(text)
                close()
              }}
            >
              Use this
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
