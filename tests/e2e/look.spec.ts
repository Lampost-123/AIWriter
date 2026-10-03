// Look and focus (milestone 6), walked through the way Adam uses them:
//
//  - An accent colour picked in Settings › Appearance shows at once and is there from the first frame after a restart.
//  - Focus mode: F11 hides everything but the page (the window fills the screen); Esc and F11 leave it, and the
//    panels come back with the same widths. The caret, the text and the line Adam is on stay where they were.
//  - Less motion when the system asks for it: transitions and animations stop.
//  - The New look: the default after updating, with a one-time note offering Classic; Settings › Appearance › Style
//    switches between the two at once, and the window opens in the one chosen.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, newDataDir, openSettings, test } from './helpers'

// The checks that read the window are written as text: this file is typed for Node, not the window.
const root = (win: Page, name: string): Promise<string> =>
  win.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)
const accentAttr = (win: Page): Promise<string | null> => win.evaluate<string | null>('document.documentElement.dataset.accent ?? null')
const painted = (win: Page): Promise<string> => win.evaluate<string>("document.documentElement.dataset.theme ?? ''")
const fullScreen = (app: ElectronApplication): Promise<boolean> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
const inFocus = (win: Page): Promise<boolean> => win.evaluate<boolean>("'focus' in document.documentElement.dataset")
const binderPane = (win: Page) => win.locator('aside[aria-label="Binder"]')
const scenePanel = (win: Page) => win.locator('aside[aria-label="Scene panel"]')
const lookAttr = (win: Page): Promise<string | null> => win.evaluate<string | null>('document.documentElement.dataset.look ?? null')
const width = async (win: Page, sel: ReturnType<typeof binderPane>): Promise<number> => Math.round((await sel.boundingBox())?.width ?? 0)

/** The caret: the text before it in its paragraph, and the paragraph's text. */
const caret = (win: Page): Promise<{ before: string; para: string }> =>
  win.evaluate<{ before: string; para: string }>(`(() => {
    const sel = document.getSelection()
    const p = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement).closest('p')
    const r = document.createRange()
    r.setStart(p, 0)
    r.setEnd(sel.anchorNode, sel.anchorOffset)
    return { before: r.toString(), para: p.textContent ?? '' }
  })()`)

test('an accent colour shows at once, everywhere, and is there from the first frame after a restart', async ({ launch }) => {
  const first = await launch()
  const { win } = first
  await createWorldFromWelcome(win, 'Harbour')
  await openSettings(win, 'Appearance')

  const swatches = win.getByRole('radiogroup', { name: 'Accent colour' })
  await expect(swatches.getByRole('radio', { name: 'Theme colour' })).toHaveAttribute('aria-checked', 'true')
  await swatches.getByRole('radio', { name: 'Teal' }).click()
  await expect(swatches.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true')
  expect(await accentAttr(win)).toBe('teal')
  const teal = { light: '#1d6b78', dark: '#6fbccb', sepia: '#1c5f69' }[await painted(win)]
  expect(await root(win, '--accent')).toBe(teal)
  // The focus ring and the selection follow the accent too.
  expect(await root(win, '--focus')).toBe(teal)
  await expect.poll(async () => (await invoke(win, 'getSettings')).accent).toBe('teal')

  // The arrow keys move through the swatches, picking as they go.
  await swatches.getByRole('radio', { name: 'Teal' }).focus()
  await win.keyboard.press('ArrowRight')
  await expect(swatches.getByRole('radio', { name: 'Indigo' })).toBeFocused()
  expect(await accentAttr(win)).toBe('indigo')
  await win.keyboard.press('ArrowLeft')
  expect(await accentAttr(win)).toBe('teal')
  await expect.poll(async () => (await invoke(win, 'getSettings')).accent).toBe('teal')

  // Each theme has its own shade of it.
  await invoke(win, 'updateSettings', { theme: 'dark' })
  await win.reload()
  await expect(binder(win)).toBeVisible()
  expect(await root(win, '--accent')).toBe('#6fbccb')
  await first.close()

  // Restarted: the window opens in it, before the settings have even been read.
  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  expect(await second.win.evaluate<string | null>('window.aiwrite.initialAccent ?? null')).toBe('teal')
  expect(await accentAttr(second.win)).toBe('teal')
  expect(await root(second.win, '--accent')).toBe('#6fbccb')

  // The theme's own colour again.
  await openSettings(second.win, 'Appearance')
  await second.win.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio', { name: 'Theme colour' }).click()
  expect(await accentAttr(second.win)).toBeNull()
  expect(await root(second.win, '--accent')).toBe('#8fb0dc')
  await expect.poll(async () => (await invoke(second.win, 'getSettings')).accent).toBeNull()
})

test('focus mode: F11 shows only the page; Esc and F11 leave, with the panels, caret and text as they were', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Harbour')
  const page = win.locator('.scene-prose')
  await page.click()
  const words = 'The fog rolled in over the grey water, and the gulls cried over the harbour wall. '
  for (let i = 0; i < 3; i++) await win.keyboard.type(words)
  // Both panels open, at widths of Adam's own.
  await invoke(win, 'updateSettings', { layout: { binderWidth: 300, inspectorWidth: 380, binderOpen: true, inspectorOpen: true } })
  await win.reload()
  await expect(page).toBeVisible()
  await page.click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.press('Home')
  for (let i = 0; i < 12; i++) await win.keyboard.press('ArrowRight')
  await expect.poll(() => width(win, binderPane(win))).toBe(300)
  await expect.poll(() => width(win, scenePanel(win))).toBe(380)
  const layout = (await invoke(win, 'getSettings')).layout
  const text = await page.innerText()
  const at = await caret(win)
  const lineTop = async (): Promise<number> => win.evaluate<number>('document.getSelection().getRangeAt(0).getBoundingClientRect().top')

  // The top bar's button says how.
  await expect(win.getByRole('button', { name: 'Focus mode' })).toHaveAttribute('title', 'Focus mode (F11)')

  // F11: the page alone, filling the screen.
  const topBefore = await lineTop()
  await win.keyboard.press('F11')
  await expect.poll(() => inFocus(win)).toBe(true)
  await expect.poll(() => fullScreen(app)).toBe(true)
  // Shut (a closed panel keeps only its 1px edge, which is see-through).
  await expect.poll(() => width(win, binderPane(win))).toBeLessThanOrEqual(1)
  await expect.poll(() => width(win, scenePanel(win))).toBeLessThanOrEqual(1)
  await expect(win.locator('header[data-focus-chrome]').first()).toHaveCSS('visibility', 'hidden')
  await expect(win.locator('main header[data-focus-chrome]')).toHaveCSS('opacity', '0')
  // A quiet word count at the foot of the screen.
  await expect(win.getByText(/^\d+ words$/).last()).toBeVisible()
  // The line Adam is on stays where it was on screen; the caret and the text are untouched.
  await expect.poll(async () => Math.abs((await lineTop()) - topBefore)).toBeLessThan(4)
  expect(await caret(win)).toEqual(at)
  expect(await page.innerText()).toBe(text)
  // Writing carries on, at the caret.
  await win.keyboard.type('XY')
  expect((await caret(win)).before).toBe(`${at.before}XY`)
  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')

  // Esc leaves: the panels come back at the same widths, the saved layout never changed.
  await win.keyboard.press('Escape')
  await expect.poll(() => inFocus(win)).toBe(false)
  await expect.poll(() => fullScreen(app)).toBe(false)
  await expect.poll(() => width(win, binderPane(win))).toBe(300)
  await expect.poll(() => width(win, scenePanel(win))).toBe(380)
  await expect(win.locator('main header[data-focus-chrome]')).toHaveCSS('opacity', '1')
  expect((await invoke(win, 'getSettings')).layout).toEqual(layout)
  expect(await caret(win)).toEqual(at)
  expect(await page.innerText()).toBe(text)
  await expect(page).toBeFocused()

  // F11 leaves too. Ask the world still opens in it, over the page's edge, and closing it leaves the layout alone.
  await win.keyboard.press('F11')
  await expect.poll(() => inFocus(win)).toBe(true)
  await win.keyboard.press('Control+K')
  await win.keyboard.type('Ask the world')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('complementary', { name: 'Scene panel' })).toBeVisible()
  await expect.poll(() => width(win, scenePanel(win))).toBe(380)
  expect(await inFocus(win)).toBe(true)
  await page.click()
  await win.keyboard.press('F11')
  await expect.poll(() => inFocus(win)).toBe(false)
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout).toEqual(layout)
  await expect.poll(() => fullScreen(app)).toBe(false)

  // The command palette and the shortcuts list know it.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('Focus mode')
  await expect(win.getByRole('option', { name: /^Focus mode/ })).toBeVisible()
  await win.keyboard.press('Enter')
  await expect.poll(() => inFocus(win)).toBe(true)
  await win.keyboard.press('Escape')
  await expect.poll(() => inFocus(win)).toBe(false)
  await win.locator('body').click({ position: { x: 600, y: 5 } })
  await win.keyboard.press('?')
  const list = win.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(list.getByText('Focus mode: only the page shows (press again to leave)')).toBeVisible()
})

test('when the system asks for less motion, transitions and animations stop', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Harbour')
  const pane = binderPane(win)
  await expect(pane).toHaveCSS('transition-duration', '0.2s')
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await expect(pane).toHaveCSS('transition-duration', '1e-05s')
  // Animations end at once, once (a pulsing dot doesn't flicker).
  const anim = await win.evaluate<{ duration: string; count: string }>(`(() => {
    const el = document.createElement('div')
    el.className = 'animate-pulse'
    document.body.append(el)
    const s = getComputedStyle(el)
    const out = { duration: s.animationDuration, count: s.animationIterationCount }
    el.remove()
    return out
  })()`)
  expect(anim).toEqual({ duration: '1e-05s', count: '1' })
  await win.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(pane).toHaveCSS('transition-duration', '0.2s')
})

/** What Adam gets (no look chosen for the test), from settings kept by a version before the New look when `before`. */
async function asAdam(launch: (o?: { dataDir?: string; env?: Record<string, string> }) => Promise<{ win: Page; dataDir: string; close(): Promise<void> }>, before: boolean, dataDir = newDataDir()) {
  if (before) {
    mkdirSync(join(dataDir, 'app'), { recursive: true })
    writeFileSync(join(dataDir, 'app', 'settings.json'), JSON.stringify({ theme: 'light' }))
  }
  return launch({ dataDir, env: { AIWRITE_LOOK: '' } })
}

test('the New look: the default after updating, offered Classic once; Style switches at once and is kept', async ({ launch }) => {
  const note = (win: Page) => win.getByRole('region', { name: 'The new look' })

  // Updating from before the New look: it shows, with the note.
  const first = await asAdam(launch, true)
  await createWorldFromWelcome(first.win, 'Harbour')
  expect(await lookAttr(first.win)).toBe('new')
  await expect(note(first.win)).toContainText('AI Write has a new look')
  await note(first.win).getByRole('button', { name: 'Keep the new look' }).click()
  await expect(note(first.win)).toBeHidden()
  await expect.poll(async () => (await invoke(first.win, 'getSettings')).lookNote).toBe(false)
  await first.close()

  // Never again.
  const second = await launch({ dataDir: first.dataDir, env: { AIWRITE_LOOK: '' } })
  await expect(binder(second.win)).toBeVisible()
  expect(await second.win.evaluate<string | null>('window.aiwrite.initialLook ?? null')).toBe('new')
  await expect(note(second.win)).toBeHidden()

  // Settings › Appearance › Style: Classic, at once (the radio follows), and kept.
  await openSettings(second.win, 'Appearance')
  const style = second.win.getByRole('radiogroup', { name: 'Style' })
  await expect(style.getByRole('radio', { name: 'New look' })).toHaveAttribute('aria-checked', 'true')
  await style.getByRole('radio', { name: 'Classic' }).click()
  expect(await lookAttr(second.win)).toBe('classic')
  await expect(style.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await invoke(second.win, 'getSettings')).look).toBe('classic')
  // Classic draws today's line icons; the New look its two-tone ones.
  await expect(second.win.locator('header svg.lucide').first()).toBeVisible()
  // The arrow keys move between the two, picking as they go.
  await style.getByRole('radio', { name: 'Classic' }).focus()
  await second.win.keyboard.press('ArrowLeft')
  await expect(style.getByRole('radio', { name: 'New look' })).toBeFocused()
  expect(await lookAttr(second.win)).toBe('new')
  await expect(second.win.locator('header svg.lucide')).toHaveCount(0)
  await second.win.keyboard.press('ArrowRight')
  expect(await lookAttr(second.win)).toBe('classic')
  await expect.poll(async () => (await invoke(second.win, 'getSettings')).look).toBe('classic')
  await second.close()

  // Restarted: the window opens in Classic, before the settings have even been read.
  const third = await launch({ dataDir: first.dataDir, env: { AIWRITE_LOOK: '' } })
  await expect(binder(third.win)).toBeVisible()
  expect(await third.win.evaluate<string | null>('window.aiwrite.initialLook ?? null')).toBe('classic')
  expect(await lookAttr(third.win)).toBe('classic')
})

test('the New look: "Switch to Classic" in the note switches for good; a fresh install gets no note', async ({ launch }) => {
  const { win, dataDir, close } = await asAdam(launch, true)
  await createWorldFromWelcome(win, 'Harbour')
  const note = win.getByRole('region', { name: 'The new look' })
  await note.getByRole('button', { name: 'Switch to Classic' }).click()
  await expect(note).toBeHidden()
  expect(await lookAttr(win)).toBe('classic')
  await expect.poll(async () => await invoke(win, 'getSettings')).toMatchObject({ look: 'classic', lookNote: false })
  await close()
  const again = await launch({ dataDir, env: { AIWRITE_LOOK: '' } })
  await expect(binder(again.win)).toBeVisible()
  expect(await lookAttr(again.win)).toBe('classic')
  await expect(again.win.getByRole('region', { name: 'The new look' })).toBeHidden()

  // A fresh install: the New look, with nothing to compare it with, so no note.
  const fresh = await asAdam(launch, false)
  await expect(fresh.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  expect(await lookAttr(fresh.win)).toBe('new')
  await expect(fresh.win.getByRole('region', { name: 'The new look' })).toBeHidden()
  expect((await invoke(fresh.win, 'getSettings')).lookNote).toBe(false)
})
