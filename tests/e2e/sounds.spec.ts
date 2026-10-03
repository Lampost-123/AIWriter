// AI sound effects under Read aloud, the way Adam uses them, against the fake speech server (tests/fake-speech, which
// makes sounds at once) and the fake AI (tests/fake-provider):
//
//  - Settings › Read aloud and dictation › More: "Sound effects and ambience" is off at first; turned on, the volume
//    and the sounds kept show. Settings › Models then has "Thinking for sound effects" under the Read aloud model.
//  - The scene panel's Sounds tab (only while sound effects are on): empty at first, in plain words. Words selected in
//    the page and "Add a sound" place an effect on them (Undo takes it out again); an ambience is added the same way.
//    The page marks each sound's words. Remove, then Undo, brings it back. The palette's "Sounds in this scene" opens
//    the tab.
//  - A sound's own volume (the row's slider) and mute, each with Undo or back from the same menu; a new take, kept
//    and gone back from.
//  - The reading bar's "Mute sounds in this scene", kept with the scene and back on.
//  - Reading the scene aloud fires the door's effect as its word is read (seen through the window's test log of the
//    sounds reading reached, which localStorage `aiwrite.soundsLog` turns on).
//
// Needs the whole feature: the sounds core (src/main/sounds, ipc/sounds.ts, the read-aloud plan's sounds) and the
// speech engine's sound model and fake (tests/fake-speech), besides this window's part.
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { binder, createWorldFromWelcome, expect, invoke, newDataDir, openSettings, startFake, test, useFakeModel } from './helpers'

interface FakeSpeech {
  url: string
  close(): Promise<void>
}

const load = <T>(file: string): Promise<T> => import(pathToFileURL(join(__dirname, file)).href) as Promise<T>

async function startSpeech(): Promise<FakeSpeech> {
  const { startFakeSpeech } = await load<{ startFakeSpeech(o: object): Promise<FakeSpeech> }>('../fake-speech/server.mjs')
  return startFakeSpeech({ sounds: true })
}

/**
 * A data folder whose speech folder already holds the sound effects' download, as the fake download steps leave it
 * (tests/fake-speech/install.mjs) and as AI Write records it once they have all worked (speech/installed.json).
 */
function withSoundModel(): string {
  const dataDir = newDataDir()
  const home = join(dataDir, 'app', 'speech')
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, AIWRITE_SPEECH_HOME: home }
  for (const step of ['venv', 'weights', 'check'])
    execFileSync(process.execPath, [join(__dirname, '..', 'fake-speech', 'install.mjs'), 'sounds', step], { env, stdio: 'ignore' })
  writeFileSync(join(home, 'installed.json'), JSON.stringify({ sounds: { at: new Date().toISOString() } }))
  return dataDir
}

const prose = (win: Page) => win.locator('.scene-prose')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const soundsTab = (win: Page) => scenePanel(win).getByRole('tab', { name: 'Sounds' })
const soundsPanel = (win: Page) => scenePanel(win).getByRole('tabpanel', { name: 'Sounds' })
const sound = (win: Page, name: string | RegExp) => soundsPanel(win).getByRole('group', { name })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
/** One toast (the newest saying these words), so its own Undo is pressed. */
const toast = (win: Page, words: string) => toasts(win).locator('> div').filter({ hasText: words }).last()
const readingBar = (win: Page) => win.getByRole('region', { name: 'Reading aloud' })

const DOOR = 'A heavy wooden door slamming shut'
const RAIN = 'Steady rain on a tin roof'
const SCENE = ['Rain hammered the tin roof.', 'Then the door slammed shut.']

/**
 * Selects these words in the page (the first place they appear) with the keyboard, as Adam might: the arrow keys to
 * the top of the scene and on to them, then Shift and the arrow keys over them. The page reads it as it would his own,
 * and its "Selected words" bar shows before anything else is clicked.
 */
async function selectWords(win: Page, words: string): Promise<void> {
  const paragraphs = await prose(win).locator('p').allTextContents()
  let before = 0
  let found = -1
  for (const p of paragraphs) {
    const at = p.indexOf(words)
    if (found < 0 && at >= 0) found = before + at
    // Past the end of a paragraph, one more step goes to the start of the next.
    before += p.length + 1
  }
  if (found < 0) throw new Error(`“${words}” isn’t in the page`)
  await prose(win).focus()
  // Just after it gets the keyboard, the editor puts its own selection back (20 ms later): keys before then are undone.
  await win.waitForTimeout(150)
  // To the top of the scene from wherever the caret is (one step per character and paragraph is always enough).
  for (let i = 0; i < before; i++) await win.keyboard.press('ArrowLeft')
  for (let i = 0; i < found; i++) await win.keyboard.press('ArrowRight')
  for (let i = 0; i < words.length; i++) await win.keyboard.press('Shift+ArrowRight')
  await expect(win.getByRole('toolbar', { name: 'Selected words' })).toBeVisible()
}

/** Opens a sound's "…" menu in the Sounds view and picks one of its items. */
async function soundMenu(win: Page, name: string, description: string, item: string): Promise<void> {
  const row = sound(win, name)
  await row.hover()
  await row.getByRole('button', { name: `More for: ${description}` }).click()
  await win.getByRole('menuitem', { name: item }).click()
}

/** How many sounds the fake speech server has been asked to make so far. */
async function made(speech: FakeSpeech): Promise<number> {
  const res = await fetch(`${speech.url.replace(/\/v1$/, '')}/__sounds`)
  return ((await res.json()) as unknown[]).length
}

/** The sounds reading has reached so far (the window's test log). */
const heard = (win: Page): Promise<{ edge: string; soundId: string; cueId: string; played: boolean }[]> =>
  win.evaluate('[...(window.__aiwriteSounds ?? [])]')

test('sound effects: the switch, the Sounds tab with Add, Remove and Undo, and an effect fired on its word', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    // The sound effects' download is done (its own card is the speech engine's, with its own tests).
    const { win } = await launch({ dataDir: withSoundModel() })
    await createWorldFromWelcome(win, 'Tin roof')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await useFakeModel(win, fake)
    expect((await invoke(win, 'getSettings')).speech.soundEffects).toBe(false)

    // The scene, in Adam's words.
    await prose(win).click()
    for (const [i, para] of SCENE.entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(para)
    }

    // Off at first: no Sounds tab.
    await expect(scenePanel(win).getByRole('tab', { name: 'Issues' })).toBeVisible()
    await expect(soundsTab(win)).toHaveCount(0)

    // Settings › Read aloud and dictation › More: the switch, then the volume and the sounds kept.
    await openSettings(win, 'Read aloud and dictation')
    await win.getByRole('button', { name: 'More', exact: true }).click()
    const toggle = win.getByRole('switch', { name: 'Sound effects and ambience' })
    await expect(toggle).not.toBeChecked()
    await expect(win.getByText('The AI adds quiet sounds under the reading: a door on the word it slams, rain while it falls. Made on this computer.')).toBeVisible()
    await expect(win.getByLabel('Sounds volume')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.soundEffects).toBe(true)
    await expect(win.getByLabel('Sounds volume')).toHaveValue('0.5')
    await expect(win.getByRole('button', { name: 'Clear sounds' })).toBeVisible()
    await expect(win.getByText(/sounds? kept/)).toBeVisible()

    // Settings › Models: its own Thinking under the Read aloud model, Off at first.
    // Settings is open already: its own list goes to Models.
    await win.getByRole('navigation').getByRole('button', { name: 'Models' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Thinking for sound effects' })).toBeVisible()
    await expect(win.getByRole('radiogroup', { name: 'Sound effects thinking' }).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')

    // Back to the scene: the Sounds tab, empty, in plain words.
    await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().click()
    await expect(prose(win)).toBeVisible()
    await soundsTab(win).click()
    await expect(soundsPanel(win).getByText('No sounds in this scene yet')).toBeVisible()

    // Add a sound: the door, on "slammed".
    await selectWords(win, 'slammed')
    await soundsPanel(win).getByRole('button', { name: 'Add a sound' }).click()
    const form = soundsPanel(win).getByRole('region', { name: 'Add a sound' })
    await expect(form).toContainText('On “slammed”')
    await form.getByLabel('What it sounds like').fill(DOOR)
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(toasts(win).getByText('Sound added.')).toBeVisible()
    await expect(sound(win, `Sound effect: ${DOOR}`)).toContainText('on “slammed”')
    // Its words are marked faintly in the page.
    await expect(prose(win).locator('.aw-sound')).toHaveText(['slammed'])

    // Undo takes it out again; added once more.
    await toast(win, 'Sound added.').getByRole('button', { name: 'Undo' }).click()
    await expect(sound(win, `Sound effect: ${DOOR}`)).toHaveCount(0)
    await expect(prose(win).locator('.aw-sound')).toHaveCount(0)
    await selectWords(win, 'slammed')
    await soundsPanel(win).getByRole('button', { name: 'Add a sound' }).click()
    await form.getByLabel('What it sounds like').fill(DOOR)
    await form.getByLabel('What it sounds like').press('Enter')
    await expect(sound(win, `Sound effect: ${DOOR}`)).toBeVisible()

    // An ambience: the rain, from "Rain hammered" to the end of the scene.
    await selectWords(win, 'Rain hammered')
    await soundsPanel(win).getByRole('button', { name: 'Add a sound' }).click()
    await form.getByRole('radio', { name: 'Ambience' }).click()
    await expect(form).toContainText('From “Rain hammered” to the end of the scene')
    await form.getByLabel('What it sounds like').fill(RAIN)
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(sound(win, `Ambience: ${RAIN}`)).toContainText('from “Rain hammered” to the end of the scene')
    // In reading order: the rain first.
    await expect(soundsPanel(win).getByRole('group')).toHaveCount(2)
    await expect(soundsPanel(win).getByRole('group').first()).toHaveAccessibleName(`Ambience: ${RAIN}`)

    // Remove, from the row's menu; Undo brings it back.
    const rain = sound(win, `Ambience: ${RAIN}`)
    await rain.hover()
    await rain.getByRole('button', { name: `More for: ${RAIN}` }).click()
    await win.getByRole('menuitem', { name: 'Remove' }).click()
    await expect(toasts(win).getByText('Sound removed.')).toBeVisible()
    await expect(rain).toHaveCount(0)
    await toast(win, 'Sound removed.').getByRole('button', { name: 'Undo' }).click()
    await expect(rain).toBeVisible()

    // Its own volume, from the row's menu: the slider shows in the row, Enter saves it; Undo puts it back.
    await soundMenu(win, `Ambience: ${RAIN}`, RAIN, 'Volume…')
    const slider = rain.getByRole('slider', { name: `Volume of ${RAIN}` })
    await expect(slider).toHaveValue('1')
    await slider.fill('1.5')
    await expect(rain).toContainText('150%')
    await slider.press('Enter')
    await expect(slider).toHaveCount(0)
    await expect(toasts(win).getByText('Volume changed.')).toBeVisible()
    await expect(rain).toContainText('150% volume')
    await toast(win, 'Volume changed.').getByRole('button', { name: 'Undo' }).click()
    await expect(rain).not.toContainText('% volume')

    // Muted, it stays in the list, quieter, and its words are marked more faintly; unmuted again from the same menu.
    const door = sound(win, `Sound effect: ${DOOR}`)
    await soundMenu(win, `Sound effect: ${DOOR}`, DOOR, 'Mute this sound')
    await expect(toasts(win).getByText('Sound muted.')).toBeVisible()
    await expect(door).toContainText('Muted')
    await expect(prose(win).locator('.aw-sound-muted')).toHaveText(['slammed'])
    await soundMenu(win, `Sound effect: ${DOOR}`, DOOR, 'Unmute this sound')
    await expect(door).not.toContainText('Muted')
    await expect(prose(win).locator('.aw-sound-muted')).toHaveCount(0)

    // The palette opens the tab from another one.
    await scenePanel(win).getByRole('tab', { name: /Scene card|Card/ }).click()
    await win.keyboard.press('Control+K')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('sounds in this scene')
    await win.keyboard.press('Enter')
    await expect(soundsTab(win)).toHaveAttribute('aria-selected', 'true')

    // Both sounds are made (the fake speech server makes them at once).
    await expect(soundsPanel(win).getByText('Being made…')).toHaveCount(0, { timeout: 30_000 })

    // A new take: made afresh, then kept; another, then gone back from.
    const takes = await made(speech)
    const take = door.getByRole('group', { name: `New take of ${DOOR}` })
    await soundMenu(win, `Sound effect: ${DOOR}`, DOOR, 'New take')
    await expect(take).toBeVisible({ timeout: 30_000 })
    expect(await made(speech)).toBeGreaterThan(takes)
    await expect(take.getByRole('button', { name: 'Listen to the new take' })).toBeVisible()
    await take.getByRole('button', { name: 'Keep it' }).click()
    await expect(take).toHaveCount(0)
    await soundMenu(win, `Sound effect: ${DOOR}`, DOOR, 'New take')
    await expect(take).toBeVisible({ timeout: 30_000 })
    await take.getByRole('button', { name: 'Go back' }).click()
    await expect(take).toHaveCount(0)
    await expect(door).not.toContainText('new take')

    // Reading the scene: the door's effect fires as its word is read.
    await win.evaluate(() => localStorage.setItem('aiwrite.soundsLog', '1'))
    await prose(win).click()
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })

    // The bar's "Mute sounds in this scene" (paused, so the short reading doesn't end first): kept with the scene,
    // and back on.
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Paused')
    const mute = readingBar(win).getByRole('button', { name: 'Mute sounds in this scene' })
    await expect(mute).toHaveAttribute('aria-pressed', 'false')
    await mute.click()
    await expect(mute).toHaveAttribute('aria-pressed', 'true')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await expect.poll(async () => (await invoke(win, 'getSceneSounds', sceneId, [])).muted).toBe(true)
    await mute.click()
    await expect(mute).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(async () => (await invoke(win, 'getSceneSounds', sceneId, [])).muted).toBe(false)
    await win.keyboard.press('Control+l')

    await expect
      .poll(async () => (await heard(win)).some((e) => e.edge === 'fire' && e.played), { timeout: 30_000 })
      .toBe(true)
    // Nothing ever goes wrong out loud: the bar never shows a problem.
    await expect(readingBar(win)).not.toContainText('Try again')
    // (Two short lines: the reading may already have reached the end; stopping is harmless then.)
    await win.keyboard.press('Control+Shift+Space')
    await expect(win.getByRole('button', { name: 'Listen', exact: true })).toHaveAttribute('aria-pressed', 'false')

    // Turned off in Settings, the tab goes.
    await invoke(win, 'updateSettings', { speech: { soundEffects: false } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await expect(soundsTab(win)).toHaveCount(0)
  } finally {
    await speech.close()
    await fake.close()
  }
})
