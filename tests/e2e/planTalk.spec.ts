// The talks tell the truth (chat-truth R1, R2, R6): in Build with AI, the plan's talk and the cast and world list's
// talk, against the fake provider (tests/fake-provider/story.mjs). A plan change whose parts aren't in the plan
// (fake/plan-wrong-tags: "I've moved those scenes to the kitchen." with tags the plan hasn't got) changes nothing, the
// line under the answer says why, and the answer never says the scenes were moved. A list change that doesn't read
// (fake/talk-unreadable) is the same for the cast and world talk. Invented text only.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const area = (win: Page) => win.locator('main').locator('[data-plan-hub]')

/** The writer model, changed without a reload (the talks read it for each request). */
async function model(win: Page, fake: FakeProvider, modelId: string): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
}

async function say(talk: ReturnType<Page['locator']>, words: string): Promise<void> {
  await talk.getByLabel('What would you like changed?').fill(words)
  await talk.getByRole('button', { name: 'Send' }).click()
}

test('the plan and cast talks: a change that can’t be made says why, and never claims it was made', async ({ launch }) => {
  test.setTimeout(150_000)
  const fake = await startFake({ delayMs: 1 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    await useFakeModel(win, fake)
    await binder(win).locator('[data-story-menu]').click()
    await win.getByRole('menuitem', { name: 'Build with AI' }).click()
    await expect(area(win)).toHaveAttribute('data-plan-hub', 'start')
    await area(win).getByLabel(/^Your idea, in your own words/).fill('A lighthouse keeper’s daughter has one winter to find out who is wrecking ships on purpose.')

    // ----- The plan's talk: the parts it named aren't in the plan -----
    await model(win, fake, 'fake/plan-wrong-tags')
    const planTalk = area(win).locator('[data-talk^="plan:"]')
    await say(planTalk, 'Move those scenes to the kitchen')
    const outcome = planTalk.locator('[data-outcome]').last()
    await expect(outcome).toHaveAttribute('data-outcome', 'refused')
    await expect(outcome).toHaveText('Nothing was changed: the parts it named aren’t in the plan.')
    await expect(planTalk).toContainText('No change was made, so there’s nothing to apply.')
    await expect(planTalk).toContainText('I’d move those scenes to the kitchen.')
    await expect(planTalk).not.toContainText('I’ve moved')
    await expect(planTalk.locator('[data-talk-preview]')).toHaveCount(0)

    // ----- The cast and world talk: a list that doesn't read -----
    await model(win, fake, 'fake/writer')
    await area(win).locator('[data-nav="cast"]').click()
    await area(win).locator('[data-plan-codex]').click()
    await expect(area(win).locator('[data-codex-list]')).toContainText('Ada Lorne')
    await model(win, fake, 'fake/talk-unreadable')
    const codexTalk = area(win).locator('[data-talk^="codex:"]')
    await say(codexTalk, 'Add a rival')
    const said = codexTalk.locator('[data-outcome]').last()
    await expect(said).toHaveAttribute('data-outcome', 'refused')
    await expect(said).toContainText('Nothing was changed: ')
    await expect(codexTalk).toContainText('No change was made')
    await expect(codexTalk).not.toContainText('I’ve added')
    await expect(codexTalk.locator('[data-talk-preview]')).toHaveCount(0)
    await expect(area(win).locator('[data-codex-list]')).not.toContainText('Corin Vale')
  } finally {
    await fake.close()
  }
})
