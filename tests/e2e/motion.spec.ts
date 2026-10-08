// The New look's motion (docs/ARCHITECTURE.md, "The two looks", Motion), on the sample world: what opens from the
// keyboard appears at once, a page change from the pointer crossfades (and from the keyboard it doesn't), and less
// motion makes every change instant. Timings are read from the animations the window really runs.
// (Code run in the window is written as text: the tests' own types have no DOM.)
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const rail = (win: Page) => win.getByRole('navigation', { name: 'Areas' })
const area = (win: Page, name: string) => rail(win).getByRole('button', { name, exact: true })
const list = (win: Page) => win.locator('[data-area-list]')
const main = (win: Page) => win.locator('main')

async function sampleWorld(launch: (o?: { env?: Record<string, string> }) => Promise<{ win: Page }>): Promise<Page> {
  const { win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await win.reload()
  await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return win
}

interface Running {
  name: string
  ms: number
}

/** The animations the first element matching `selector` runs right now (name and duration in ms), or null if none matches. */
const animationsOf = (win: Page, selector: string): Promise<Running[] | null> =>
  win.evaluate<Running[] | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    return el.getAnimations().map((a) => ({ name: a.animationName ?? '', ms: Number(a.effect.getTiming().duration) }))
  })()`)

/** The CSS animation-name of the first element matching `selector`. */
const animationName = (win: Page, selector: string): Promise<string> =>
  win.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).animationName`)

interface PageChange {
  parts: { part: string; ms: number }[]
}

/**
 * Counts the page changes that crossfade, and keeps the pseudo-element animations each one runs (which part, and how
 * long) as soon as it starts.
 */
const watchPageChanges = (win: Page): Promise<void> =>
  win.evaluate(`(() => {
    window.vts = []
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = (update) => {
      const seen = { parts: [] }
      window.vts.push(seen)
      const vt = start(update)
      vt.ready.then(() => {
        seen.parts = document.getAnimations()
          .filter((a) => a.effect && a.effect.pseudoElement)
          .map((a) => ({ part: a.effect.pseudoElement, ms: Number(a.effect.getTiming().duration) }))
      }, () => undefined)
      return vt
    }
  })()`)
const pageChanges = (win: Page): Promise<PageChange[]> => win.evaluate<PageChange[]>('window.vts')

test('the New look: what opens from the keyboard appears at once', async ({ launch }) => {
  const win = await sampleWorld(launch)
  const open = '[role="dialog"][data-state="open"]'

  // The command palette and its dim: no animation from the very first frame, and it goes at once too.
  await win.keyboard.press('Control+K')
  await expect(win.getByRole('dialog', { name: 'Search' })).toBeVisible()
  expect(await animationsOf(win, open)).toEqual([])
  expect(await animationName(win, open)).toBe('none')
  expect(await animationName(win, '.bg-overlay[data-state="open"]')).toBe('none')
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog', { name: 'Search' })).toHaveCount(0)

  // The shortcuts list (?) and find in the story (Ctrl+Shift+F).
  await win.locator('body').click({ position: { x: 600, y: 5 } })
  await win.keyboard.press('?')
  await expect(win.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  expect(await animationsOf(win, open)).toEqual([])
  await win.keyboard.press('Escape')
  await win.keyboard.press('Control+Shift+F')
  await expect(win.getByRole('dialog', { name: 'Find and replace in the story' })).toBeVisible()
  expect(await animationsOf(win, open)).toEqual([])
  await win.keyboard.press('Escape')

  // Find in the scene (Ctrl+F).
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+F')
  await expect(win.getByRole('search', { name: 'Find in this scene' })).toBeVisible()
  expect(await animationsOf(win, '[role="search"]')).toEqual([])
  await win.keyboard.press('Escape')

  // Classic keeps its pop (the same rules, with the look switched under them).
  await win.evaluate(`document.documentElement.dataset.look = 'classic'`)
  await win.locator('body').click({ position: { x: 600, y: 5 } })
  await win.keyboard.press('Control+K')
  await expect(win.getByRole('dialog', { name: 'Search' })).toBeVisible()
  expect(await animationName(win, open)).toBe('pop-in')
})

test('the New look: a page change from the pointer crossfades; from the keyboard, back to the page and with less motion it is instant', async ({
  launch
}) => {
  const win = await sampleWorld(launch)
  await watchPageChanges(win)

  // The rail: the page and the side list crossfade (the old page goes quicker than the new one comes).
  await area(win, 'World').click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  await expect.poll(async () => (await pageChanges(win)).length).toBe(1)
  await expect.poll(async () => (await pageChanges(win))[0].parts.length).toBeGreaterThan(0)
  const first = (await pageChanges(win))[0].parts
  expect(first).toEqual(
    expect.arrayContaining([
      { part: '::view-transition-old(page)', ms: 140 },
      { part: '::view-transition-new(page)', ms: 280 },
      { part: '::view-transition-old(side-list)', ms: 140 },
      { part: '::view-transition-new(side-list)', ms: 150 }
    ])
  )
  // Nothing else in the window takes part (it stays live), and the mark comes off once it is over.
  expect(first.every((p) => /\((page|side-list|toasts)\)$/.test(p.part))).toBe(true)
  await expect.poll(() => win.evaluate<string | null>('document.documentElement.dataset.vt ?? null')).toBeNull()

  // Another page in the same area: only the page.
  await list(win).getByRole('button', { name: /^Characters/ }).click()
  await expect(list(win).getByRole('button', { name: /^Characters/ })).toHaveAttribute('aria-current', 'page')
  await expect.poll(async () => (await pageChanges(win)).length).toBe(2)
  await expect.poll(async () => (await pageChanges(win))[1].parts.length).toBeGreaterThan(0)
  expect((await pageChanges(win))[1].parts.some((p) => p.part.includes('side-list'))).toBe(false)

  // Back to the writing page: at once.
  await area(win, 'Write').click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  expect((await pageChanges(win)).length).toBe(2)

  // From the keyboard: the palette's Enter opens the codex at once.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('codex')
  await win.keyboard.press('Enter')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  expect((await pageChanges(win)).length).toBe(2)

  // With less motion (Windows' Animation effects off), the pointer changes pages at once too.
  await area(win, 'Write').click()
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await area(win, 'Plan').click()
  await expect(list(win)).toHaveAttribute('data-area-list', 'plan')
  expect((await pageChanges(win)).length).toBe(2)
  // And should one start anyway, the stylesheet stops its pictures moving.
  const moving = await win.evaluate<number>(`(async () => {
    document.documentElement.dataset.vt = 'page'
    const vt = document.startViewTransition(() => undefined)
    await vt.ready
    const parts = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement).length
    await vt.finished
    delete document.documentElement.dataset.vt
    return parts
  })()`)
  expect(moving).toBe(0)
})

test('the New look: an amber caret stands where a streaming draft’s words arrive, and goes when it ends', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10, slowDelayMs: 40 })
  try {
    const { win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake, 'fake/slow')
    const header = win.locator('main header')
    const caret = win.locator('.scene-prose .aw-stream-caret')
    await win.locator('.scene-prose').click()
    await win.keyboard.type('The tide was out. ')
    await expect(caret).toHaveCount(0)

    await header.getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: /^Add below/ }).click()
    await expect(header.locator('.gen-running')).toBeVisible()
    // Once words arrive: one caret, at the very end of the last paragraph, blinking.
    await expect(caret).toHaveCount(1)
    await expect(caret).toBeVisible()
    expect(
      await win.evaluate<boolean>(`(() => {
        const c = document.querySelector('.scene-prose .aw-stream-caret')
        const last = document.querySelector('.scene-prose').lastElementChild
        // (ProseMirror may put an empty helper after it, for the cursor.)
        let after = ''
        for (let n = c.nextSibling; n; n = n.nextSibling) after += n.textContent
        return c.parentElement === last && after === ''
      })()`)
    ).toBe(true)
    expect(await animationsOf(win, '.scene-prose .aw-stream-caret')).toEqual([{ name: 'aw-sugg-blink', ms: 1100 }])
    // The same caret stays while words keep coming into its paragraph (its blink doesn't restart with every word).
    await win.evaluate(`window.streamCaret = document.querySelector('.scene-prose .aw-stream-caret')`)
    const words = async () => (await win.locator('.scene-prose').innerText()).split(/\s+/).length
    const before = await words()
    await expect.poll(words).toBeGreaterThan(before + 3)
    expect(await win.evaluate<boolean>(`(() => {
      const c = document.querySelector('.scene-prose .aw-stream-caret')
      return c === window.streamCaret || c.parentElement !== window.streamCaret.parentElement
    })()`)).toBe(true)

    // Classic never shows it.
    await win.evaluate(`document.documentElement.dataset.look = 'classic'`)
    await expect(caret).toHaveCount(0)
    await win.evaluate(`document.documentElement.dataset.look = 'new'`)
    await expect(caret).toHaveCount(1)

    // Stopped: gone that moment.
    await header.getByRole('button', { name: 'Stop' }).click()
    await expect(header.locator('.gen-running')).toHaveCount(0)
    await expect(caret).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
