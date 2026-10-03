import { ipcMain } from 'electron'
import type { AppApi, ApiMethod, IpcResult } from '@shared/api'
import { UserError } from '../util'
import { coreHandlers } from './core'
import { aiHandlers } from './ai'
import { maintenanceHandlers } from './maintenance'
import { memoryHandlers } from './memory'
import { keeperHandlers } from './keeper'
import { viewsHandlers } from './views'
import { builderHandlers } from './builder'
import { entryViewsHandlers } from './entryViews'
import { worldViewsHandlers } from './worldViews'
import { manuscriptHandlers } from './manuscript'
import { searchHandlers } from './search'
import { storiesHandlers } from './stories'
import { storyFlowsHandlers } from './storyFlows'
import { tasksHandlers } from './tasks'
import { historyHandlers } from './history'
import { variantsHandlers } from './variants'
import { beatsHandlers } from './beats'
import { editsHandlers } from './edits'
import { askHandlers } from './ask'
import { outlineHandlers } from './outline'
import { speechHandlers } from './speech'
import { readAloudHandlers } from './readAloud'
import { dictationHandlers } from './dictation'
import { worldBuilderHandlers } from './worldBuilder'
import { checksHandlers } from './checks'
import { transferHandlers } from './transfer'
import { importingHandlers } from './importing'
import { usageHandlers } from './usage'
import { askFirst } from '../usage'
import { setupHandlers } from './setup'
import { lookHandlers } from './look'
import { libraryHandlers } from './library'
import { recipesHandlers } from './recipes'
import { styleHandlers } from './style'
import { polishHandlers } from './polish'
import { findHandlers } from './find'
import { spellingHandlers } from './spelling'

export type Handlers<K extends ApiMethod> = { [M in K]: (...args: Parameters<AppApi[M]>) => Awaited<ReturnType<AppApi[M]>> | ReturnType<AppApi[M]> }

/** Every API method must be implemented exactly once; TypeScript checks this. */
const all: Handlers<ApiMethod> = {
  ...coreHandlers,
  ...aiHandlers,
  ...maintenanceHandlers,
  ...memoryHandlers,
  ...keeperHandlers,
  ...viewsHandlers,
  ...builderHandlers,
  ...entryViewsHandlers,
  ...worldViewsHandlers,
  ...manuscriptHandlers,
  ...searchHandlers,
  ...storiesHandlers,
  ...storyFlowsHandlers,
  // Milestone 4
  ...tasksHandlers,
  ...historyHandlers,
  ...variantsHandlers,
  ...beatsHandlers,
  ...editsHandlers,
  ...askHandlers,
  ...outlineHandlers,
  ...speechHandlers,
  ...readAloudHandlers,
  ...dictationHandlers,
  ...worldBuilderHandlers,
  // Milestone 5
  ...checksHandlers,
  // Milestone 6
  ...transferHandlers,
  ...importingHandlers,
  ...usageHandlers,
  ...setupHandlers,
  ...lookHandlers,
  // The start screen
  ...libraryHandlers,
  // Story recipes
  ...recipesHandlers,
  // Genres and writing styles
  ...styleHandlers,
  ...polishHandlers,
  // Writing by hand
  ...findHandlers,
  ...spellingHandlers
}

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
        // Milestone 6: an AI action Adam starts asks first while this month's spending has reached his limit.
        askFirst(name)
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
      } catch (err) {
        return { ok: false, error: plainMessage(err) }
      }
    })
  }
}
