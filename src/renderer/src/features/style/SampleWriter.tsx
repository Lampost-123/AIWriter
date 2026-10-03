import { RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ID, StyleGuide } from '@shared/types'
import { Button, IconButton, Spinner, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { keepSample } from './feelLogic'
import { clearSample, putSampleText, registerSampleField, sampleKey, stopSample, useSamples, writeSample } from './sampleStore'

/**
 * "Write a sample for me", under the Sample passage field: writes about 200 words in the style on screen and
 * shows them arriving in a card of fixed height, with Stop, then Use this (fills the field, with Undo) and Try
 * again. `style` is asked for when the button is clicked, so it is the style as the screen shows it then.
 */
export function SampleWriter({
  worldId,
  storyId,
  style,
  current,
  onUse
}: {
  worldId: ID
  /** The story whose guide this is, or null for the world's. */
  storyId: ID | null
  style: () => StyleGuide
  /** The Sample passage field's text now. */
  current: string
  onUse: (text: string) => void
}): React.JSX.Element {
  const key = sampleKey(worldId, storyId)
  const run = useSamples((s) => s.runs[key] ?? null)
  const running = run?.status === 'running'
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  useEffect(() => registerSampleField(key, onUse), [key, onUse])

  // While it writes, keep the newest words in view, unless Adam has scrolled up to read.
  useEffect(() => {
    const el = body.current
    if (el && running && follow.current) el.scrollTop = el.scrollHeight
  }, [run?.text, running])

  const start = (): void => {
    follow.current = true
    if (body.current) body.current.scrollTop = 0
    void writeSample(key, storyId, style())
  }

  const use = (): void => {
    if (!run) return
    const kept = keepSample(current, run.text)
    if (!kept) return
    onUse(kept.next)
    clearSample(key)
    // Undo goes to the form on screen then, and changes only the sample passage.
    toast(kept.message, {
      action: {
        label: 'Undo',
        run: () => {
          if (!putSampleText(key, kept.previous)) toast('Open the style guide again to change the sample passage back.')
        }
      }
    })
  }

  const failedEmpty = run?.status === 'error' && !run.text.trim()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" icon={<Sparkles size={14} className="text-ai" />} onClick={start} disabled={running}>
          Write a sample for me
        </Button>
        <p className="min-w-0 text-[12px] text-faint">Writes about 200 words from the genre, prose style, point of view and tense.</p>
      </div>

      {run ? (
        <div className="overflow-hidden rounded-lg border border-ai/30 bg-ai-soft animate-fade-in">
          <div
            ref={body}
            onScroll={(e) => {
              const el = e.currentTarget
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
            aria-live="off"
            className="h-[248px] overflow-y-auto px-4 py-3 font-serif text-[15px] leading-[1.65] whitespace-pre-wrap text-fg select-text"
          >
            {run.text ? (
              run.text
            ) : failedEmpty ? (
              <span className="flex h-full items-center justify-center px-4 text-center font-sans text-[13px] leading-relaxed text-danger">{run.problem}</span>
            ) : (
              <span className="flex h-full items-center justify-center gap-2 font-sans text-[13px] text-muted">
                <Spinner size={14} /> Writing a sample…
              </span>
            )}
          </div>
          <div className="flex h-11 items-center gap-2 border-t border-ai/20 px-3">
            <p className={cn('min-w-0 flex-1 truncate text-[12px]', run.status === 'error' ? 'text-danger' : 'text-muted')}>
              {failedEmpty ? '' : statusLine(run.status, run.retrying, run.cutOff, run.problem)}
            </p>
            {running ? (
              <Button size="sm" icon={<Square size={12} />} onClick={() => stopSample(key)}>
                Stop
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={start}>
                  Try again
                </Button>
                <Button size="sm" variant="ai" onClick={use} disabled={!run.text.trim()}>
                  Use this
                </Button>
                <IconButton label="Close the sample" size="sm" onClick={() => clearSample(key)}>
                  <X size={14} />
                </IconButton>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function statusLine(status: string, retrying: string | null, cutOff: boolean, problem: string | null): string {
  if (status === 'running') return retrying ?? 'Writing…'
  if (status === 'error') return problem ?? ''
  if (status === 'stopped') return 'Stopped. You can still use what it wrote.'
  if (cutOff) return 'It ran out of room before the end.'
  return 'Use this puts it in the sample passage above.'
}
