import { app } from 'electron'
import { join } from 'node:path'

/**
 * Where app data lives. AIWRITE_DATA_DIR (used by tests) puts both the app's
 * own settings and the default library under one folder.
 */
export function userDataDir(): string {
  const override = process.env.AIWRITE_DATA_DIR
  return override ? join(override, 'app') : app.getPath('userData')
}

export function defaultLibraryDir(): string {
  const override = process.env.AIWRITE_DATA_DIR
  if (override) return join(override, 'library')
  try {
    return join(app.getPath('documents'), 'AI Write')
  } catch {
    // Windows can fail to report Documents (e.g. a redirected folder that is offline).
    return join(app.getPath('home'), 'AI Write')
  }
}
