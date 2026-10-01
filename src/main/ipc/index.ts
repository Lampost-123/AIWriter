import { ipcMain } from 'electron'
import type { AppApi, ApiMethod, IpcResult } from '@shared/api'
import { UserError } from '../util'
import { coreHandlers } from './core'
import { aiHandlers } from './ai'
import { maintenanceHandlers } from './maintenance'

export type Handlers<K extends ApiMethod> = { [M in K]: (...args: Parameters<AppApi[M]>) => Awaited<ReturnType<AppApi[M]>> | ReturnType<AppApi[M]> }

/** Every API method must be implemented exactly once; TypeScript checks this. */
const all: Handlers<ApiMethod> = { ...coreHandlers, ...aiHandlers, ...maintenanceHandlers }

function plainMessage(err: unknown): { message: string; code?: string } {
  if (err instanceof UserError) return { message: err.message, code: err.code }
  console.error(err)
  const raw = err instanceof Error ? err.message : String(err)
  return { message: `Something went wrong: ${raw}` }
}

export function registerIpc(): void {
  for (const [name, fn] of Object.entries(all)) {
    ipcMain.handle(`api:${name}`, async (_e, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
      } catch (err) {
        return { ok: false, error: plainMessage(err) }
      }
    })
  }
}
