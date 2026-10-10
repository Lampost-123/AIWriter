// "Write this chapter with AI" (the binder's chapter menu, the command palette): says what it does, lists the scenes it
// will write (those without a card to write from are left out, and said so), and that words already there are kept for
// Undo, then starts it. While this month's spending limit holds AI calls, the window asks first (lib/api.ts). Mounted
// once in the workspace; it also starts listening for runs (chapterWriterStore.ts).

import { useEffect, useState } from 'react'
import type { ChapterWriterPlan } from '@shared/contracts/chapterWriter'
import { Button, Dialog, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { planWords } from './chapterWriterLogic'
import { closeChapterWriter, listenChapterWriter, startChapterWriter, useChapterWriter } from './chapterWriterStore'

export function ChapterWriterDialog(): React.JSX.Element {
  const ask = useChapterWriter((s) => s.ask)
  const [plan, setPlan] = useState<ChapterWriterPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => listenChapterWriter(), [])

  useEffect(() => {
    setPlan(null)
    setError(null)
    if (!ask) return
    let live = true
    api
      .chapterWriterPlan(ask)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setError(plainReason(e)))
    return () => {
      live = false
    }
  }, [ask])

  const start = async (): Promise<void> => {
    if (!ask) return
    setStarting(true)
    setError(null)
    try {
      await startChapterWriter(ask)
      closeChapterWriter()
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setStarting(false)
    }
  }

  const words = plan ? planWords(plan) : null
  const noModel = !!error && /Settings › Models/.test(error)
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && closeChapterWriter()}
      title="Write this chapter with AI"
      description={words ? words.intro : ' '}
      width={500}
      footer={
        <>
          <Button onClick={closeChapterWriter}>Cancel</Button>
          <Button
            variant="primary"
            loading={starting}
            disabled={!plan || !words?.ready || plan.busy}
            onClick={() => void start()}
            data-autofocus
            data-testid="chapter-writer-start"
          >
            Write the chapter
          </Button>
        </>
      }
    >
      <div className="min-h-16" aria-live="polite" data-testid="chapter-writer-plan">
        {!plan && !error ? <p className="text-[13px] text-faint">Looking at the chapter…</p> : null}
        {plan ? (
          <>
            <ul className="space-y-1 text-[13px]">
              {plan.scenes.map((s) => (
                <li key={s.sceneId} className="flex items-baseline gap-2">
                  <span className={s.ready ? 'text-fg' : 'text-faint'}>{s.label}</span>
                  <span className="text-[12px] text-faint">
                    {!s.ready ? 'no scene card to write from: left out' : s.hasWords ? 'has words: they will be replaced' : 'empty: will be written'}
                  </span>
                </li>
              ))}
            </ul>
            {words && !words.ready ? (
              <div className="mt-3">
                <Notice>Give a scene a goal, beats or an outcome on its card, and the AI can write it from that.</Notice>
              </div>
            ) : null}
            {words?.warning ? <p className="mt-3 text-[13px] leading-relaxed text-muted">{words.warning}</p> : null}
            {plan.busy ? <p className="mt-3 text-[13px] text-muted">The AI is already writing a chapter. Wait for it to finish, or stop it from the top bar.</p> : null}
            <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
              It makes many AI calls: what it has spent shows in the top bar while it works.
            </p>
          </>
        ) : null}
        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
        {noModel ? (
          <button
            type="button"
            className="mt-2 rounded text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => {
              closeChapterWriter()
              useApp.getState().navigate({ kind: 'settings', tab: 'models' })
            }}
          >
            Open Settings › Models
          </button>
        ) : null}
      </div>
    </Dialog>
  )
}
