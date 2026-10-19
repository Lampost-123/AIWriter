// "Fill in the whole story" (the story index, 2026-10-19): says what it does and roughly what it costs before anything
// is asked of the model, then starts it as background memory work (progress and Stop in the top bar and on the memory
// page). While this month's spending limit holds AI calls, the window asks first (lib/api.ts). Mounted once in the
// workspace, beside the re-read's dialog.

import { useEffect, useState } from 'react'
import type { StoryFillEstimate } from '@shared/contracts/storyIndex'
import { Button, Dialog, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { pointsToSettings } from './logic'
import { closeStoryFill, fillCostWords, fillIntro, fillSoFarWords, fillStarted, useStoryFill } from './storyFill'

export function StoryFillDialog(): React.JSX.Element {
  const ask = useStoryFill((s) => s.ask)
  const [estimate, setEstimate] = useState<StoryFillEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    setEstimate(null)
    setError(null)
    if (!ask) return
    let live = true
    api
      .estimateStoryFill(ask.storyId)
      .then((e) => live && setEstimate(e))
      .catch((e) => live && setError(plainReason(e)))
    return () => {
      live = false
    }
  }, [ask])

  const start = async (): Promise<void> => {
    if (!ask) return
    setStarting(true)
    try {
      await api.startStoryFill(ask.storyId)
      toast(fillStarted(estimate?.scenes ?? 1))
      closeStoryFill()
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setStarting(false)
    }
  }

  const problem = estimate?.problem ?? null
  const nothing = estimate !== null && !problem && estimate.scenes === 0
  const soFar = estimate && !problem ? fillSoFarWords(estimate) : ''
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && closeStoryFill()}
      title="Fill in the whole story"
      description={ask ? fillIntro(ask.title) : ' '}
      width={480}
      footer={
        <>
          <Button onClick={closeStoryFill}>{nothing ? 'Close' : 'Cancel'}</Button>
          {nothing ? null : (
            <Button variant="primary" loading={starting} disabled={!estimate || !!problem} onClick={() => void start()} data-autofocus>
              Fill in
            </Button>
          )}
        </>
      }
    >
      <div className="min-h-10" aria-live="polite" data-testid="story-fill-cost">
        {problem ? (
          // No model to fill in with (or the spending limit): why, and the way to Settings, closing the dialog on the way.
          <div role="alert">
            <Notice
              action={
                !pointsToSettings(problem) ? null : (
                  <Button
                    size="sm"
                    onClick={() => {
                      closeStoryFill()
                      useApp.getState().navigate({ kind: 'settings', tab: 'models' })
                    }}
                  >
                    Open Settings
                  </Button>
                )
              }
            >
              {problem}
            </Notice>
          </div>
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : nothing ? (
          <p className="text-[13px] text-muted">
            Every scene of this story is filled in already. New scenes are filled in as you write them.
          </p>
        ) : estimate ? (
          <>
            <p className="text-[13px] leading-relaxed text-fg">{fillCostWords(estimate)}</p>
            {soFar ? <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{soFar}</p> : null}
          </>
        ) : (
          <p className="text-[13px] text-faint">Working out the cost…</p>
        )}
      </div>
    </Dialog>
  )
}
