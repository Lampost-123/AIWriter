// Quick foundation check: launch the built app, create a world, screenshot.
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-'))
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, AIWRITE_DATA_DIR: dir } })
const win = await app.firstWindow()
win.on('console', (m) => console.log('console:', m.type(), m.text()))
win.on('pageerror', (e) => console.log('pageerror:', e.message))
await win.waitForSelector('text=Create a world', { timeout: 15000 })
await win.screenshot({ path: process.argv[2] + '/welcome.png' })
await win.fill('input', 'The Northern Reaches')
await win.click('button:has-text("Create world")')
await win.waitForTimeout(1500)
await win.screenshot({ path: process.argv[2] + '/workspace.png' })
await app.close()
console.log('ok', dir)
