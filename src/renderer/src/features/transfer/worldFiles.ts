// Whole worlds as files (milestone 6, World files and export): Export world, Import a world file and Make a
// copy, from the world menu, the Welcome screen and the command palette. Each ends in a toast; a job that
// takes a while shows how it is getting on in a toast of its own meanwhile.

import type { ID } from '@shared/types'
import type { Exported, TransferProgress } from '@shared/contracts/transfer'
import { toast, useToasts } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll, flushBeforeWorldChange } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { exportedText, progressText } from './transferLogic'

/** How long a job runs before its progress toast shows (a quick one never flashes one). */
const SHOW_AFTER_MS = 400

/**
 * Runs a job, calling `onProgress` with its progress events. With `toastWhat`, a toast ("Exporting ‘X’…")
 * shows how it is getting on once it has run a moment; it goes when the job ends.
 */
export async function withProgress<T>(
  run: (jobId: ID) => Promise<T>,
  opts: { toastWhat?: string; onProgress?: (p: TransferProgress) => void } = {}
): Promise<T> {
  const jobId = crypto.randomUUID()
  let toastId: number | null = null
  let latest = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  // Shows the latest words (again, if the toast has timed out while a slow step ran).
  const show = (): void => {
    const toasts = useToasts.getState()
    if (toastId !== null && toasts.items.some((t) => t.id === toastId)) toasts.update(toastId, { message: latest })
    else toastId = toast(latest)
  }
  // The first progress comes once the work starts (after any file dialog), so nothing shows while Adam picks a file.
  const off = onEvent('transfer:progress', (p) => {
    if (p.jobId !== jobId) return
    opts.onProgress?.(p)
    if (!opts.toastWhat) return
    latest = `${opts.toastWhat}: ${progressText(p.step.charAt(0).toLowerCase() + p.step.slice(1), p.fraction)}`
    if (toastId !== null) show()
    else timer ??= setTimeout(show, SHOW_AFTER_MS)
  })
  try {
    return await run(jobId)
  } finally {
    if (timer) clearTimeout(timer)
    off()
    if (toastId !== null) useToasts.getState().dismiss(toastId)
  }
}

const failed = (e: unknown): void => void toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })

/** The toast once a file is saved: "Exported ‘X’" with Show in folder. */
export function announceExported(done: Exported): void {
  toast(exportedText(done.fileName, done.note), {
    tone: 'success',
    action: { label: 'Show in folder', run: () => void api.showExported(done.path).catch(failed) }
  })
}

const isOpen = (worldId: ID | null): boolean => !worldId || worldId === useApp.getState().world?.id

/** Exports a world (the open one by default) as one .aiwrite file, after saving anything still being typed. */
export async function exportWorld(worldId: ID | null = null): Promise<void> {
  try {
    if (isOpen(worldId)) await flushAll()
    const done = await withProgress((jobId) => api.exportWorldFile({ jobId, worldId }), { toastWhat: 'Exporting the world' })
    if (done) announceExported(done)
  } catch (e) {
    failed(e)
  }
}

/** Asks for a .aiwrite file, imports it as a new world and opens it. */
export async function importWorld(): Promise<void> {
  try {
    const made = await withProgress((jobId) => api.importWorldFile({ jobId }), { toastWhat: 'Importing the world' })
    if (!made) return
    await flushBeforeWorldChange()
    await useApp.getState().openWorld(made.id)
    toast(`Imported ‘${made.name}’. It's open now.`, { tone: 'success' })
  } catch (e) {
    failed(e)
  }
}

/** Makes a copy of a world (the open one by default), with Open on its toast. True once it is made. */
export async function copyWorld(worldId: ID | null = null): Promise<boolean> {
  const id = worldId ?? useApp.getState().world?.id
  if (!id) return false
  try {
    if (isOpen(id)) await flushAll()
    const made = await withProgress((jobId) => api.copyWorld({ jobId, worldId: id }), { toastWhat: 'Making a copy' })
    toast(`Made a copy: ‘${made.name}’.`, {
      tone: 'success',
      action: {
        label: 'Open',
        run: () =>
          void flushBeforeWorldChange()
            .then(() => useApp.getState().openWorld(made.id))
            .catch(failed)
      }
    })
    return true
  } catch (e) {
    failed(e)
    return false
  }
}
