import { RELEASES_URL } from '@shared/defaults'
import { createWorldFromWelcome, expect, openSettings, test } from './helpers'

test('About shows the version and update status; a downloaded update is offered, never forced', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Updates')
  await openSettings(win, 'About and updates')

  const version = await app.evaluate(({ app }) => app.getVersion())
  await expect(win.getByText(`Version ${version}`, { exact: true })).toBeVisible()
  // Not an installed app, so updates are off, said calmly.
  await expect(win.getByText('Automatic updates only run in the installed app.')).toBeVisible()
  await expect(win.getByRole('link', { name: /All versions on GitHub/ })).toHaveAttribute('href', RELEASES_URL)
  await expect(win.getByRole('button', { name: 'Open folder' })).toBeEnabled()

  const banner = win.getByRole('status').filter({ hasText: 'A new version of AI Write is ready' })
  await expect(banner).toBeHidden()

  // What the updater sends once a download finishes.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('event:update:status', { state: 'ready', version: '9.9.9', notes: 'Faster saving\n• Calmer backups' })
  })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Faster saving')
  await expect(banner.getByRole('button', { name: 'Restart to update' })).toBeVisible()
  await expect(win.getByText('Version 9.9.9 is ready to install')).toBeVisible()

  await banner.getByRole('button', { name: 'Later' }).click()
  await expect(banner).toBeHidden()
  // Still offered on the About page, and the app is still running.
  await expect(win.getByRole('button', { name: 'Restart to update' })).toBeVisible()
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})
