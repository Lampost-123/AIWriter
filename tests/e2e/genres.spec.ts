// Genres and writing styles, end to end against the fake OpenAI-compatible server: the Story feel area on the
// Style guide screen (genre tiles, how far it goes, the AI phrases switch), "Write a sample for me", and a draft's
// briefing carrying the genre, the content levels and the rules against AI phrasing. Every word here is made up.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
// A picked tile's name carries its Main or Blend mark.
const tile = (win: Page, name: string) => main(win).getByRole('button', { name: new RegExp(`^${name}( Main| Blend)?$`) })
const shots = process.env.AIWRITE_SHOTS

test('Story feel: pick genres and content levels, write a sample, and drafts are told about them', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Saltmarsh')
    await useFakeModel(win, fake)

    await binder(win).getByRole('button', { name: 'Style guide' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
    await expect(main(win).getByText('Story feel', { exact: true })).toBeVisible()

    // Two genres blend: the first leads, the second adds its feel; clicking a picked one takes it off.
    await tile(win, 'Horror').click()
    await expect(tile(win, 'Horror')).toHaveAttribute('aria-pressed', 'true')
    await tile(win, 'Mystery').click()
    await expect(tile(win, 'Mystery')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(win, 'Horror')).toContainText('Main')
    await expect(tile(win, 'Mystery')).toContainText('Blend')
    await tile(win, 'Cosy').click()
    await expect(tile(win, 'Cosy')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(win, 'Mystery')).toHaveAttribute('aria-pressed', 'false')
    await tile(win, 'Cosy').click()
    await tile(win, 'Mystery').click()

    // How far it goes: Violence vivid, Language mild; clicking the picked step again leaves it to the genre.
    const scale = (name: string) => main(win).getByRole('group', { name, exact: true })
    await scale('Violence').getByRole('button', { name: 'Vivid' }).click()
    await expect(scale('Violence').getByRole('button', { name: 'Vivid' })).toHaveAttribute('aria-pressed', 'true')
    await scale('Language').getByRole('button', { name: 'Mild' }).click()
    await scale('Romance').getByRole('button', { name: 'None' }).click()
    await scale('Romance').getByRole('button', { name: 'None' }).click()
    await expect(scale('Romance').getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'false')

    await expect
      .poll(async () => (await invoke(win, 'getWorld'))?.style)
      .toMatchObject({ genres: ['horror', 'mystery'], intensity: { violence: 3, language: 2 } })
    if (shots) await win.screenshot({ path: `${shots}/style-feel.png`, fullPage: true })

    // The AI phrases switch is on by default and is Adam's own preference.
    const phrases = main(win).getByRole('switch', { name: 'Steer clear of common AI phrases' })
    await expect(phrases).toBeChecked()

    // Write a sample for me: it streams into a card, and Use this puts it in the sample passage.
    await main(win).getByRole('button', { name: 'Write a sample for me' }).click()
    await expect(main(win).getByRole('button', { name: 'Use this' })).toBeEnabled({ timeout: 15_000 })
    if (shots) await win.screenshot({ path: `${shots}/style-sample.png`, fullPage: true })
    await main(win).getByRole('button', { name: 'Use this' }).click()
    await expect(main(win).getByLabel('Sample passage')).not.toHaveValue('')
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('[AIWRITE-STYLE v1] sample')

    // A draft's briefing carries the genre, the content levels and the rules against AI phrasing.
    const story = (await invoke(win, 'listStories'))[0]
    const outline = await invoke(win, 'getOutline', story.id)
    const sceneId = outline.scenes[0].id
    const preview = await invoke(win, 'previewContext', sceneId, { direction: '', targetWords: 1000, creativity: 'balanced' })
    const sent = preview.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('This story is mostly horror, with the feel of mystery.')
    expect(sent).toContain('- Violence: make it vivid and physical')
    expect(sent).toContain('Write like a person, not like an AI')
    expect(sent).toContain('Keep the slow-building dread of horror, with the sharp, fair-play curiosity of mystery.')
  } finally {
    await fake.close()
  }
})
