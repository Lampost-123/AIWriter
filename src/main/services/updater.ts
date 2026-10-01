// Auto-update from GitHub Releases. OWNED BY THE BACKUPS/PACKAGING WORKER: replace these stubs.
import type { UpdateStatus } from '@shared/types'

let status: UpdateStatus = { state: 'idle' }

export const getUpdateStatus = (): UpdateStatus => status
export async function checkForUpdates(): Promise<UpdateStatus> {
  status = { state: 'none' }
  return status
}
export async function installUpdate(): Promise<void> {}
export function initUpdater(): void {}
