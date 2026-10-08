// "Re-read this scene" / "Re-read the whole story" (World Memory Overhaul B8): says what it does and roughly what it
// costs before anything is asked of the model, then starts it through the memory keeper's queue. While this month's
// spending limit holds AI calls, the window asks first (lib/api.ts). Mounted once in the workspace.

import { useEffect, useState } from 'react'
import type { RereadEstimate } from '@shared/types'
import { Button, Dialog, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import { closeReread, rereadCostWords, rereadIntro, rereadStarted, useReread } from './reread'

export function RereadDialog(): React.JSX.Element {
  const ask = useReread((s) => s.ask)
  const [estimate, setEstimate] = useState<RereadEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    setEstimate(null)
    setError(null)
    if (!ask) return
    let live = true
    api
      .estimateReread(ask.target)
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
      await api.startReread(ask.target)
      toast(rereadStarted(ask.target, estimate?.scenes ?? 1))
      closeReread()
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setStarting(false)
    }
  }

  const scene = !!ask && 'sceneId' in ask.target
  const problem = estimate?.problem ?? null
  const nothing = estimate !== null && !problem && estimate.scenes === 0
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && closeReread()}
      title={scene ? 'Re-read this scene' : 'Re-read the whole story'}
      description={ask ? rereadIntro(ask.target, ask.title) : ' '}
      width={460}
      footer={
        <>
          <Button onClick={closeReread}>Cancel</Button>
          <Button variant="primary" loading={starting} disabled={!estimate || !!problem || nothing} onClick={() => void start()} data-autofocus>
            Re-read
          </Button>
        </>
      }
    >
      <div className="min-h-10" aria-live="polite" data-testid="reread-cost">
        {problem ? (
          <ProblemNotice message={problem} />
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : nothing ? (
          <p className="text-[13px] text-muted">There are no words to read there yet.</p>
        ) : estimate ? (
          <p className="text-[13px] leading-relaxed text-fg">{rereadCostWords(estimate)}</p>
        ) : (
          <p className="text-[13px] text-faint">Working out the cost…</p>
        )}
        {problem ? (
          <button
            type="button"
            className="mt-2 rounded text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => {
              closeReread()
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
