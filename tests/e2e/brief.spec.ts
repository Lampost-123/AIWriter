// A continuity brief before each scene (long story memory fix 14), end to end against the fake provider: the plan's one
// call also reads the story record and writes a brief (tests/fake-provider/plan.mjs: each list from what it was given,
// and a line citing a scene it was never given, which the app leaves out); the writer gets it as a late block right
// before the scene card; the Context tab shows the last one written; Settings › Models turns it off, and the plan goes
// on as before. Invented test text only.
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

// Planning and the brief on; the memory reads a scene once and not again on its own while the test runs.
const ON = { env: { AIWRITE_PLAN: 'on', AIWRITE_BRIEF: 'on', AIWRITE_KEEPER_QUIET_MS: '600000' } }
const OPTIONS = { targetWords: 600, creativity: 'balanced' as const, direction: '' }

test('a draft gets a continuity brief from the plan’s own call; shown in the Context tab, and off in Settings', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await createWorldFromWelcome(win, 'Millrace')
    const mara = await invoke(win, 'createEntry', 'character', {
      name: 'Mara',
      summary: 'Runs the ferry.',
      fields: { marks: 'No left hand' }
    })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    // Not in the briefing: the fake planner asks for it, so the plan is seen to go on with the brief and without it.
    await invoke(win, 'createEntry', 'place', { name: 'Amber Gate', summary: 'The river gate below the mill.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, {
      ...card,
      povId: mara.id,
      presentIds: [mara.id, tobin.id],
      beats: ['Mara counts the doors from the corner.']
    })
    await useFakeModel(win, fake)

    const draft = async () => {
      const { generationId } = await invoke(win, 'startDraft', sceneId, OPTIONS)
      await expect
        .poll(async () => (await invoke(win, 'listGenerations', sceneId)).find((g) => g.id === generationId)?.status, { timeout: 60_000 })
        .toBe('complete')
      return invoke(win, 'getGeneration', generationId)
    }

    // The brief, from the plan's call: what matters, and what must not be contradicted from what must stay true; the line
    // citing a scene the planner was never given ("Ch 9, Sc 9") is left out.
    const rec = await draft()
    const brief = rec.blocks.find((b) => b.id === 'continuity-brief')!
    expect(brief.title).toBe('Continuity brief')
    expect(brief.dropped).toBe(false)
    expect(brief.text).toContain('What matters for this scene:\n- Mara carries this scene, as the card says.')
    expect(brief.text).toContain('What must not be contradicted:\n- Mara: No left hand')
    expect(brief.text).not.toContain('Ch 9, Sc 9')
    // A late block, right before the scene card; the plan goes on as ever (the entry it asked for came in).
    const user = rec.messages.find((m) => m.role === 'user')!.content
    expect(user.indexOf('## Continuity brief')).toBeGreaterThan(0)
    expect(user.indexOf('## Continuity brief')).toBeLessThan(user.indexOf('## Scene card'))
    expect(rec.blocks.find((b) => b.id === 'mentioned')?.text).toContain('Amber Gate')

    // The Context tab shows the last brief written for the scene, saying so.
    const panel = win.getByRole('complementary', { name: 'Scene panel' })
    await panel.getByRole('tab', { name: 'Context' }).click()
    const context = panel.getByRole('tabpanel', { name: 'Context' })
    await expect(context.locator('[title^="Continuity brief. The memory model writes a new one just before each draft."]')).toBeVisible({
      timeout: 30_000
    })
    expect((await invoke(win, 'previewContext', sceneId, OPTIONS)).blocks.find((b) => b.id === 'continuity-brief')?.text).toBe(brief.text)

    // Settings › Models: "Write a continuity brief before each scene", on by default, with a line on what it costs. Off: no
    // brief in the next draft, nor in the Context tab, and the plan as before.
    await openSettings(win, 'Models')
    const toggle = win.getByRole('switch', { name: 'Write a continuity brief before each scene' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(win.getByText('usually under a cent a scene on DeepSeek', { exact: false })).toBeVisible()
    await toggle.click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).continuityBrief).toBe(false)
    expect((await invoke(win, 'previewContext', sceneId, OPTIONS)).blocks.some((b) => b.id === 'continuity-brief')).toBe(false)
    const again = await draft()
    expect(again.blocks.some((b) => b.id === 'continuity-brief')).toBe(false)
    expect(again.blocks.find((b) => b.id === 'mentioned')?.text).toContain('Amber Gate')
  } finally {
    await fake.close()
  }
})
