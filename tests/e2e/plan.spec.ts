// Plan before writing and what must stay true (step 4 of the consistency plan, Adam 2026-10-07), end to end against
// the fake provider: a draft gets the list right above the instruction to write (where things stand as the scene
// before ended, with since when, and the codex's marks), and one short call to the memory model plans the scene first
// (tests/fake-provider/plan.mjs): what it gets wrong about the stage is put right or left out, the entry it asks for
// comes into the briefing, and the plan goes in after the closing instruction as the writer's own notes. Settings ›
// Models turns the plan off; the list still goes in. Invented test text only.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

// The memory reads a scene as soon as there is a model, and not again on its own while the test runs.
const PLANNING = { env: { AIWRITE_PLAN: 'on', AIWRITE_KEEPER_QUIET_MS: '600000' } }

async function draft(win: Page, sceneId: string) {
  const { generationId } = await invoke(win, 'startDraft', sceneId, { targetWords: 600, creativity: 'balanced', direction: '' })
  await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).find((g) => g.id === generationId)?.status, { timeout: 60_000 }).toBe('complete')
  return invoke(win, 'getGeneration', generationId)
}

test('a draft is planned first and keeps to what must stay true; off in Settings, only the list goes in', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(PLANNING)
    await createWorldFromWelcome(win, 'Millrace')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.', fields: { marks: 'No left hand' } })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'createEntry', 'place', { name: 'Amber Gate', summary: 'The river gate below the mill.' })
    const [story] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', story.id)
    const first = outline.scenes[0].id
    await invoke(win, 'saveSceneText', first, null, 'Mara stood at the rail in her grey cloak. Tobin watched.')
    // The same day, so what Mara wore as the scene before ended still holds as this one begins.
    await invoke(win, 'updateSceneCard', first, { ...(await invoke(win, 'getScene', first)).card, when: 'Day 1, evening' })
    const next = await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The gate' })
    const card = (await invoke(win, 'getScene', next.id)).card
    await invoke(win, 'updateSceneCard', next.id, { ...card, when: 'Day 1, night', povId: mara.id, presentIds: [mara.id, tobin.id], beats: ['They reach the gate.'] })
    await useFakeModel(win, fake)

    const rec = await draft(win, next.id)
    const block = (id: string) => rec.blocks.find((b) => b.id === id)
    const user = rec.messages.find((m) => m.role === 'user')!.content

    // What must stay true: where things stand as the scene before ended, with since when, and Mara's mark.
    const must = block('must-stay-true')!
    expect(must.dropped).toBe(false)
    // Each piece of clothing its own line (step 2b).
    expect(must.text).toContain('- Mara is wearing: grey cloak on (since Ch 1, Sc 1)')
    expect(must.text).toContain('- Mara: No left hand')
    expect(user.indexOf('## Must stay true')).toBeGreaterThan(user.indexOf('## Scene card'))
    expect(user.indexOf('## Must stay true')).toBeLessThan(user.indexOf('Write the scene now.'))

    // The plan: the stage's own words where the planner had them wrong ("a red coat"), its guess left out ("a silver
    // knife"), the change it plans kept, the one already so and the stranger the card never asks for left out; sent
    // last, as the writer's own notes.
    const plan = block('plan')!
    expect(plan.text).toContain('My notes before I write')
    expect(plan.text).toContain('- Mara is wearing: grey cloak')
    expect(plan.text).not.toContain('red coat')
    expect(plan.text).not.toContain('silver knife')
    expect(plan.text).toContain('1. Mara takes off the grey cloak and hangs it over the chair.')
    expect(plan.text).not.toContain('puts on')
    expect(plan.text).not.toContain('stranger')
    expect(user.trimEnd().endsWith('Now the prose itself:')).toBe(true)
    expect(user.indexOf('Write the scene now.')).toBeLessThan(user.indexOf('My notes before I write'))
    // The entry it asked for came into the briefing.
    expect(block('mentioned')?.text).toContain('Amber Gate')
    expect(rec.entries.map((e) => e.name)).toContain('Amber Gate')

    // Settings › Models: "Plan before writing", on by default. Off: no plan; the list still goes in.
    await openSettings(win, 'Models')
    const toggle = win.getByRole('switch', { name: 'Plan before writing' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(async () => (await invoke(win, 'getSettings')).planFirst).toBe(false)
    const again = await draft(win, next.id)
    expect(again.blocks.find((b) => b.id === 'plan')).toBeUndefined()
    expect(again.blocks.find((b) => b.id === 'must-stay-true')?.text).toContain('- Mara: No left hand')
    expect(again.messages.find((m) => m.role === 'user')!.content.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
  } finally {
    await fake.close()
  }
})
