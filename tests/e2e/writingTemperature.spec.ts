// Writing temperature (Settings › Models; Adam, 2026-10-20), end to end against the fake AI server: with a DeepSeek writer
// the setting says what DeepSeek suggests; Custom with the slider and the number box saves Adam's temperature; a draft
// and Change it are sent at it (and "What the AI saw" keeps it), while the plan and the memory keep their own.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, ROOT, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const MEMORY = /^\[AIWRITE-(MEMORY-KEEPER|ONE-READING|MEMORY-SUMMARY|CONTINUITY)/
const PLAN = '[AIWRITE-PLAN v2]'
const EDIT = '[AIWRITE-EDIT v1]'
const systemOf = (b: { messages: { role: string; content: unknown }[] }): string => {
  const c = b.messages.find((m) => m.role === 'system')?.content
  return typeof c === 'string' ? c : JSON.stringify(c ?? '')
}

test('Writing temperature: a DeepSeek writer, Custom set with the slider and the box, and only the writing sent at it', async ({ launch }) => {
  const fake = await startFake()
  try {
    // Plan before writing on, so a memory-model request goes before the draft too.
    const { win } = await launch({ env: { AIWRITE_PLAN: 'on' } })
    await createWorldFromWelcome(win, 'Alpha')
    const p = await invoke(win, 'saveProvider', { name: 'DeepSeek', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'deepseek-chat', label: 'DeepSeek Chat', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    expect((await invoke(win, 'getSettings')).writingTemperature).toBeNull()

    await openSettings(win, 'Models')
    const section = win.getByTestId('writing-temperature')
    await section.scrollIntoViewIfNeeded()
    const modes = section.getByRole('radiogroup', { name: 'Writing temperature' })
    await expect(modes.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    await expect(section).toContainText('Set by the creativity: 1.0 for Balanced.')
    await expect(section).toContainText('DeepSeek suggests about 1.5 for stories.')
    const slider = section.getByRole('slider', { name: 'Temperature' })
    const box = section.getByRole('textbox', { name: 'Temperature number' })
    await expect(slider).toBeDisabled()
    await expect(box).toBeDisabled()

    // Custom starts where DeepSeek suggests.
    await modes.getByRole('radio', { name: 'Custom' }).click()
    await expect(box).toHaveValue('1.5')
    await expect(slider).toBeEnabled()
    await expect.poll(async () => (await invoke(win, 'getSettings')).writingTemperature).toBe(1.5)
    await expect(section).toContainText('Higher is more surprising, lower is steadier.')
    await expect(modes.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
    // The choice's tint and the slider settle (150 ms) before the picture.
    await win.mouse.move(0, 0)
    await win.waitForTimeout(400)
    mkdirSync(join(ROOT, 'shots'), { recursive: true })
    await section.locator('xpath=ancestor::section[1]').screenshot({ path: join(ROOT, 'shots', 'writing-temperature.png') })

    // The slider moves in steps of 0.05; the box takes a number and keeps it within 0 to 2.
    await slider.focus()
    await win.keyboard.press('ArrowLeft')
    await expect(box).toHaveValue('1.45')
    await expect.poll(async () => (await invoke(win, 'getSettings')).writingTemperature).toBe(1.45)
    await box.fill('3')
    await box.press('Enter')
    await expect(box).toHaveValue('2.0')
    await box.fill('1.5')
    await box.press('Enter')
    await expect.poll(async () => (await invoke(win, 'getSettings')).writingTemperature).toBe(1.5)
    // A number typed is kept after a short pause, without Enter or leaving the box (closing the window can't lose it).
    await box.fill('1.3')
    await expect.poll(async () => (await invoke(win, 'getSettings')).writingTemperature).toBe(1.3)
    await expect(box).toBeFocused()
    await box.fill('1.5')
    await box.press('Enter')
    await expect.poll(async () => (await invoke(win, 'getSettings')).writingTemperature).toBe(1.5)

    // The writer's Thinking on: DeepSeek ignores the temperature, and the setting says so.
    const thinking = win.getByRole('radiogroup', { name: 'Writer model thinking', exact: true })
    await thinking.getByRole('radio', { name: 'Medium' }).click()
    await expect(section).toContainText('DeepSeek ignores the temperature while it thinks.')
    await thinking.getByRole('radio', { name: 'Off' }).click()
    await expect(section).not.toContainText('DeepSeek ignores the temperature')
    await win.keyboard.press('Escape')

    // A draft: sent at 1.5, with Balanced's top_p; the plan before it keeps the memory's own temperature.
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    fake.reset()
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await generateButton(win).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).find((g) => g.job === 'draft')?.status, { timeout: 30_000 }).toBe('complete')
    const gen = (await invoke(win, 'listGenerations', sceneId)).find((g) => g.job === 'draft')!
    const rec = await invoke(win, 'getGeneration', gen.id)
    expect(rec.params.temperature).toBe(1.5)
    expect(rec.params.ownTemperature).toBe(true)

    // Change it… on the draft's first words: an AI edit, sent at 1.5 too.
    const text = (await invoke(win, 'getScene', sceneId)).text
    const passage = text.split(/\n\n/)[0]
    const started = await invoke(win, 'startEdit', { taskId: 'temp-revise', sceneId, tool: 'revise', direction: 'Make it shorter.', selection: passage, before: '', after: text.slice(passage.length) })
    expect(started.ok).toBe(true)
    const editId = started.ok ? started.generationId : ''
    await expect.poll(async () => (await invoke(win, 'getGeneration', editId)).status, { timeout: 30_000 }).toBe('complete')
    const edit = await invoke(win, 'getGeneration', editId)
    expect(edit.params.temperature).toBe(1.5)
    expect(edit.params.ownTemperature).toBe(true)

    // The memory reads the new words afterwards, at its own temperature.
    await expect.poll(() => fake.allRequests().filter((b) => MEMORY.test(systemOf(b))).length, { timeout: 60_000 }).toBeGreaterThan(0)
    const sent = fake.allRequests()
    const writing = sent.filter((b) => !systemOf(b).startsWith('[AIWRITE-'))
    const edits = sent.filter((b) => systemOf(b).startsWith(EDIT))
    const plans = sent.filter((b) => systemOf(b).startsWith(PLAN))
    const memory = sent.filter((b) => MEMORY.test(systemOf(b)))
    expect(writing.length).toBeGreaterThan(0)
    for (const b of writing) {
      expect(b.temperature).toBe(1.5)
      expect(b.top_p).toBe(0.95)
    }
    expect(edits.length).toBe(1)
    expect(edits[0].temperature).toBe(1.5)
    expect(plans.length).toBeGreaterThan(0)
    for (const b of [...plans, ...memory]) expect(b.temperature).toBe(0.2)
  } finally {
    await fake.close()
  }
})

test('Writing temperature: Auto leaves every draft as it was', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const p = await invoke(win, 'saveProvider', { name: 'DeepSeek', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'deepseek-chat', label: 'DeepSeek Chat', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await generateButton(win).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    const draft = fake.allRequests().find((b) => !systemOf(b).startsWith('[AIWRITE-'))!
    expect(draft.temperature).toBe(1)
    const rec = await invoke(win, 'getGeneration', (await invoke(win, 'listGenerations', sceneId))[0].id)
    expect(rec.params.ownTemperature).toBeUndefined()
  } finally {
    await fake.close()
  }
})
