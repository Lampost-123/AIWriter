import { safeStorage } from 'electron'
import { join } from 'node:path'
import { userDataDir } from './paths'
import { readJson, writeFileAtomic } from './util'

// API keys are encrypted with the operating system's secure storage and kept
// in the app's own data folder, never in a world folder or a backup.

type Stored = Record<string, { enc: boolean; data: string }>

const file = (): string => join(userDataDir(), 'keys.json')

export function setSecret(name: string, value: string | null): void {
  const all = readJson<Stored>(file(), {})
  if (!value) {
    delete all[name]
  } else if (safeStorage.isEncryptionAvailable()) {
    all[name] = { enc: true, data: safeStorage.encryptString(value).toString('base64') }
  } else {
    // Only happens on Linux test machines without a keyring.
    all[name] = { enc: false, data: Buffer.from(value, 'utf8').toString('base64') }
  }
  writeFileAtomic(file(), JSON.stringify(all, null, 2))
}

export function getSecret(name: string): string | null {
  const item = readJson<Stored>(file(), {})[name]
  if (!item) return null
  const buf = Buffer.from(item.data, 'base64')
  try {
    return item.enc ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

export function hasSecret(name: string): boolean {
  return name in readJson<Stored>(file(), {})
}
