import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui'
import { registerDiscarder, registerFlusher } from '@/lib/flush'
import { Saver, type SaveStatus } from './saver'

export interface Autosave<T> {
  /** Records a change; written after a quiet pause. */
  schedule(value: T): void
  /** Writes any pending change now. Never rejects. */
  flush(): Promise<void>
  /** Drops any pending change. */
  cancel(): void
  status: SaveStatus
  error: string | null
}

/**
 * Autosave for a form. Changes are written after `delay` ms of quiet, and
 * straight away when the window closes, the world switches (registerFlusher),
 * or the component unmounts (switching scene or entry). `what` names the thing
 * being saved for the error message, e.g. "the scene card".
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, opts: { delay?: number; what: string }): Autosave<T> {
  const [state, setState] = useState<{ status: SaveStatus; error: string | null }>({ status: 'idle', error: null })
  const mounted = useRef(true)
  const what = useRef(opts.what)
  what.current = opts.what
  const [saver] = useState(
    () =>
      new Saver<T>(save, {
        delay: opts.delay ?? 500,
        onStatus: (status, error) => {
          if (mounted.current) setState((s) => (s.status === status && s.error === error ? s : { status, error }))
        },
        onGiveUp: (message) =>
          toast(
            `Your changes to ${what.current} couldn't be saved. ${/[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`} Your text is still here, and it will try again when you click away.`,
            { tone: 'danger' }
          )
      })
  )

  useLayoutEffect(() => {
    saver.setSave(save)
  })

  useEffect(() => {
    mounted.current = true
    // Waits a moment first, so other flushers that hand this form a last change
    // (a phrase typed but not yet added) are written in the same flush.
    const unregister = registerFlusher(() => Promise.resolve().then(() => saver.flush()))
    // A backup was restored: a change from before must not be written into the restored world.
    const unregisterDiscard = registerDiscarder(() => saver.cancel())
    return () => {
      mounted.current = false
      unregister()
      unregisterDiscard()
      void saver.flush()
    }
  }, [saver])

  const [actions] = useState(() => ({
    schedule: (v: T) => saver.schedule(v),
    flush: () => saver.flush(),
    cancel: () => saver.cancel()
  }))
  return { ...actions, status: state.status, error: state.error }
}
