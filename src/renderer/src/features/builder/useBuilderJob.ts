import { useEffect, useRef, useState } from 'react'
import type { BuilderDone, BuilderJob, BuilderProgress } from '@shared/contracts/builder'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'

export interface RunningJob {
  jobId: ID
  job: BuilderJob
  /** Plain words while the request is being tried again (a busy service), else null. */
  retrying: string | null
}

export interface BuilderJobHandle {
  running: RunningJob | null
  /** Starts a job with a new id. Rejects (with the plain-words reason) if it couldn't start. */
  start(job: BuilderJob, call: (jobId: ID) => Promise<void>): Promise<void>
  /** Stops the job; what has fully arrived is kept, and `onDone` still hears how it ended. */
  stop(): void
}

/**
 * One builder job at a time: its progress and how it ended, matched by the id this side makes, so
 * no event can arrive before the job is known. `stopOnLeave` stops a job still running when the
 * screen closes (suggestions nobody will see); Quick start keeps going, since it saves as it goes.
 */
export function useBuilderJob(handlers: {
  onProgress?: (p: BuilderProgress) => void
  onDone: (d: BuilderDone) => void
  stopOnLeave?: boolean
}): BuilderJobHandle {
  const current = useRef<ID | null>(null)
  const [running, setRunning] = useState<RunningJob | null>(null)
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const offProgress = onEvent('builder:progress', (p) => {
      if (p.jobId !== current.current) return
      setRunning((r) => (r && r.retrying ? { ...r, retrying: null } : r))
      latest.current.onProgress?.(p)
    })
    const offRetry = onEvent('builder:retrying', (p) => {
      if (p.jobId !== current.current) return
      setRunning((r) => (r ? { ...r, retrying: p.reason } : r))
    })
    const offDone = onEvent('builder:done', (d) => {
      if (d.jobId !== current.current) return
      current.current = null
      setRunning(null)
      latest.current.onDone(d)
    })
    return () => {
      offProgress()
      offRetry()
      offDone()
      const id = current.current
      current.current = null
      if (id && latest.current.stopOnLeave) void api.stopBuilder(id).catch(() => undefined)
    }
  }, [])

  const [handle] = useState(() => ({
    start: async (job: BuilderJob, call: (jobId: ID) => Promise<void>): Promise<void> => {
      const jobId = crypto.randomUUID()
      current.current = jobId
      setRunning({ jobId, job, retrying: null })
      try {
        await call(jobId)
      } catch (e) {
        if (current.current === jobId) {
          current.current = null
          setRunning(null)
        }
        throw e
      }
    },
    stop: (): void => {
      const id = current.current
      if (id) void api.stopBuilder(id).catch((e: Error) => void toast(`Couldn't stop it. ${e.message}`, { tone: 'danger' }))
    }
  }))

  return { running, start: handle.start, stop: handle.stop }
}
