// "Write this chapter with AI" (the binder's chapter menu, the command palette): says what it does, lists the scenes it
// will write (those with nothing on their card to write from are named, with "Plan these scenes" to plan their cards
// first, 2026-10-19), and that words already there are kept for Undo, then starts it. While this month's spending limit holds AI calls, the window asks first (lib/api.ts). Mounted
// once in the workspace; it also starts listening for runs (chapterWriterStore.ts).

import { useEffect, useRef, useState } from 'react'
import type { ChapterWriterPlan } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { Button, Dialog, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { flushAll } from '@/lib/flush'
import { WritingStatus } from '@/features/builder/parts'
import { planScene, stopScenePlan } from '@/features/outline/scenePlanStore'
import { planWords } from './chapterWriterLogic'
import { closeChapterWriter, listenChapterWriter, startChapterWriter, useChapterWriter } from './chapterWriterStore'

export function ChapterWriterDialog(): React.JSX.Element {
  const ask = useChapterWriter((s) => s.ask)
  const [plan, setPlan] = useState<ChapterWriterPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Plan these scenes (2026-10-19): which one it is planning, and whether Stop was pressed.
  const [planning, setPlanning] = useState<{ at: number; of: number; sceneId: ID } | null>(null)
  const stopped = useRef(false)
  const [rev, setRev] = useState(0)

  useEffect(() => listenChapterWriter(), [])

  useEffect(() => {
    // Looked at again after scenes are planned: the list stays while it is (no flash of "Looking at the chapter…").
    if (!rev) setPlan(null)
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
  }, [ask, rev])

  /**
   * Plan these scenes: the scenes with nothing on their cards to write from are planned one after another (the outline
   * helper's scene plan, scenePlanStore.ts), so they are written too rather than left out. One Undo takes them all back.
   */
  const planMissing = async (): Promise<void> => {
    if (!plan || planning) return
    const ids = plan.scenes.filter((s) => !s.ready).map((s) => s.sceneId)
    stopped.current = false
    const undos: (() => Promise<void>)[] = []
    let failed: string | null = null
    for (let i = 0; i < ids.length && !stopped.current; i++) {
      setPlanning({ at: i + 1, of: ids.length, sceneId: ids[i] })
      const out = await planScene(ids[i], { quiet: true })
      if (out.undo) undos.push(out.undo)
      if (out.status === 'error') {
        failed = out.error ?? 'That didn’t work. Please try again.'
        break
      }
    }
    setPlanning(null)
    // What went on the cards on screen is saved before the chapter is looked at again.
    await flushAll()
    setRev((n) => n + 1)
    if (undos.length) {
      toast(`Planned ${undos.length === 1 ? 'a scene' : `${undos.length} scenes`} of the chapter.`, {
        action: {
          label: 'Undo',
          run: () =>
            void (async () => {
              for (const undo of undos) await undo()
              setRev((n) => n + 1)
            })()
        }
      })
    }
    if (failed) setError(failed)
  }

  const stopPlanning = (): void => {
    stopped.current = true
    if (planning) stopScenePlan(planning.sceneId)
  }

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
            disabled={!plan || !words?.ready || plan.busy || !!planning}
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
                    {!s.ready
                      ? planning?.sceneId === s.sceneId
                        ? 'planning its card…'
                        : 'nothing on its card to write from yet'
                      : s.hasWords
                        ? 'has words: they will be replaced'
                        : 'empty: will be written'}
                  </span>
                </li>
              ))}
            </ul>
            {words && words.left.length ? (
              <div className="mt-3" data-testid="chapter-writer-unplanned">
                <Notice
                  action={
                    planning ? (
                      <Button size="sm" variant="ghost" onClick={stopPlanning}>
                        Stop
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => void planMissing()} data-plan-missing>
                        {words.left.length === 1 ? 'Plan this scene' : 'Plan these scenes'}
                      </Button>
                    )
                  }
                >
                  {planning ? (
                    <WritingStatus text={`Planning scene ${planning.at} of ${planning.of}…`} />
                  ) : words.left.length === 1 ? (
                    'One scene has nothing on its card to write from. Plan it, and the AI writes it too.'
                  ) : (
                    `${words.left.length} scenes have nothing on their cards to write from. Plan them, and the AI writes them too.`
                  )}
                </Notice>
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
