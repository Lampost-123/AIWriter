import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

/** The finished backup files in a folder, oldest first. */
const backupFiles = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.db')).sort() : [])

test('a backup is made at launch, Back up now adds one, and restoring brings back earlier work', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Restore Test')
  const world = (await invoke(win, 'getWorld'))!
  const folder = join(world.folder, 'backups')

  await expect.poll(() => backupFiles(folder)).toHaveLength(1)
  expect(backupFiles(folder)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_launch\.db$/)

  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara' })
  await openSettings(win, 'Backups')
  const rows = win.getByRole('list', { name: 'Backups' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('When opened')

  await win.getByRole('button', { name: 'Back up now' }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Made by you')
  expect(backupFiles(folder).filter((f) => f.endsWith('_manual.db'))).toHaveLength(1)

  await invoke(win, 'deleteEntry', mara.id)
  expect(await invoke(win, 'listEntries', 'character')).toEqual([])

  // Restore asks inside the row (no pop-up) and says the current work is kept.
  await rows.first().getByRole('button', { name: /^Restore the backup from/ }).click()
  await expect(rows.first()).toContainText('Your current work is backed up first')
  await expect(win.getByRole('dialog')).toHaveCount(0)
  await rows.first().getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(win.getByText(/Restored the backup from/)).toBeVisible()
  expect((await invoke(win, 'listEntries', 'character')).map((e) => e.name)).toEqual(['Mara'])
  expect(backupFiles(folder).filter((f) => f.endsWith('_before-restore.db'))).toHaveLength(1)
  await expect(binder(win)).toBeVisible()

  // Undo puts back the state from just before the restore.
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(win.getByText(/^Undone/)).toBeVisible()
  expect(await invoke(win, 'listEntries', 'character')).toEqual([])
})

test('reopening backs up a world that changed, and leaves an unchanged one alone', async ({ launch }) => {
  const first = await launch()
  await createWorldFromWelcome(first.win, 'Changes')
  const folder = join((await invoke(first.win, 'getWorld'))!.folder, 'backups')
  await expect.poll(() => backupFiles(folder)).toHaveLength(1)
  await first.close()

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  // The launch backup is checked for just under a second after opening.
  await second.win.waitForTimeout(1500)
  expect(backupFiles(folder)).toHaveLength(1)
  await invoke(second.win, 'createEntry', 'place', { name: 'The Keep' })
  await second.close()

  const third = await launch({ dataDir: first.dataDir })
  await expect(binder(third.win)).toBeVisible()
  await expect.poll(() => backupFiles(folder)).toHaveLength(2)
  expect(backupFiles(folder)[1]).toMatch(/_launch\.db$/)
})

test('backups are copied to a second folder while one is chosen', async ({ launch }) => {
  const extra = mkdtempSync(join(tmpdir(), 'aiwrite-e2e-extra-'))
  try {
    const { app, win, dataDir } = await launch()
    await createWorldFromWelcome(win, 'Cloud Copy')
    const world = (await invoke(win, 'getWorld'))!
    await expect.poll(() => backupFiles(join(world.folder, 'backups'))).toHaveLength(1)
    const copies = join(extra, basename(world.folder))

    // A folder inside the library is refused in plain words.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
    }, join(dataDir, 'library', 'copies'))
    await openSettings(win, 'Backups')
    await win.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(win.getByText(/Pick a folder outside your AI Write library/)).toBeVisible()

    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
    }, extra)
    await win.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(win.getByText(extra, { exact: true })).toBeVisible()
    // The newest backup is copied straight away, then each new one.
    await expect.poll(() => backupFiles(copies)).toHaveLength(1)
    await win.getByRole('button', { name: 'Back up now' }).click()
    await expect.poll(() => backupFiles(copies)).toHaveLength(2)

    await win.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Choose folder…' })).toBeVisible()
    await win.getByRole('button', { name: 'Back up now' }).click()
    await expect.poll(() => backupFiles(join(world.folder, 'backups'))).toHaveLength(3)
    expect(backupFiles(copies)).toHaveLength(2)
    expect((await invoke(win, 'getSettings')).backup.extraFolder).toBeNull()
  } finally {
    rmSync(extra, { recursive: true, force: true })
  }
})
