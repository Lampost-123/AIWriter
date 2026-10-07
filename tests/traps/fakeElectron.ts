// A stand-in for the 'electron' module, so the app's own main-process code (settings, providers, the world, the
// memory keeper, drafting) runs in plain Node for the trap harness. The trap config aliases 'electron' to this file.
// - app.getPath: the harness sets AIWRITE_DATA_DIR, so the app's paths.ts never asks; this is a fallback.
// - safeStorage: "encrypts" with a random pad that lives only in this process, so the API key written to the
//   throwaway data folder's keys.json can't be read back by anything after the run.
// - BrowserWindow: one pretend window whose webContents.send hands every app event to `appEvents`, so the harness
//   can wait for 'generation:done' and 'task:done' exactly as the window would.
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Every event the app sends to its window, by channel ('event:generation:done', ...). */
export const appEvents = new EventEmitter()
appEvents.setMaxListeners(200)

const pad = randomBytes(4096)
const xor = (b: Buffer): Buffer => Buffer.from(b.map((v, i) => v ^ pad[i % pad.length]))

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (s: string): Buffer => xor(Buffer.from(s, 'utf8')),
  decryptString: (b: Buffer): string => xor(b).toString('utf8')
}

const dataDir = (): string => process.env.AIWRITE_DATA_DIR ?? join(tmpdir(), 'aiwrite-traps')

export const app = {
  getPath: (name: string): string => join(dataDir(), name),
  setPath: (): void => {},
  getVersion: (): string => '0.0.0-traps',
  getName: (): string => 'AI Write (traps)',
  isPackaged: false,
  on: (): void => {},
  once: (): void => {},
  whenReady: (): Promise<void> => Promise.resolve(),
  quit: (): void => {}
}

const fakeWindow = {
  isDestroyed: (): boolean => false,
  webContents: {
    send: (channel: string, payload: unknown): void => {
      appEvents.emit(channel, payload)
    }
  }
}

export const BrowserWindow = {
  getAllWindows: (): (typeof fakeWindow)[] => [fakeWindow],
  getFocusedWindow: (): null => null,
  fromWebContents: (): null => null
}

const nothing = new Proxy(
  {},
  {
    get: () => () => undefined
  }
)

export const ipcMain = { handle: (): void => {}, on: (): void => {}, removeHandler: (): void => {} }
export const dialog = nothing
export const shell = nothing
export const session = nothing
export const Menu = nothing
export const nativeTheme = { shouldUseDarkColors: false, on: (): void => {}, themeSource: 'system' }
export const protocol = nothing

/** The app downloads with net.fetch (step 5's search model): a trap run never downloads anything. */
export const net = {
  fetch: (): Promise<Response> => Promise.reject(new Error('A trap run never downloads anything.'))
}

export default { app, BrowserWindow, safeStorage, ipcMain, dialog, shell, session, Menu, nativeTheme, protocol, net }
