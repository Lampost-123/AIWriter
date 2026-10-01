import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

test('first launch shows the welcome screen; creating a world opens the workspace', async ({ launch }) => {
  const { win } = await launch()
  await expect(win).toHaveTitle('AI Write')
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await expect(binder(win)).toHaveCount(0)

  await createWorldFromWelcome(win, 'The Northern Reaches')
  await expect(win.getByRole('heading', { name: 'Create a world' })).toHaveCount(0)
  const world = await invoke(win, 'getWorld')
  expect(world?.name).toBe('The Northern Reaches')
  // A new world starts with Book 1, Chapter 1, Scene 1.
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  expect(outline.chapters).toHaveLength(1)
  expect(outline.scenes).toHaveLength(1)
})

test('relaunching with the same data reopens the same world, with nothing lost', async ({ launch }) => {
  const first = await launch()
  await createWorldFromWelcome(first.win, 'Ashgrove')
  const world = await invoke(first.win, 'getWorld')
  const [story] = await invoke(first.win, 'listStories')
  const { scenes } = await invoke(first.win, 'getOutline', story.id)
  await invoke(first.win, 'saveSceneText', scenes[0].id, null, 'Mara lost her left hand at the ford.')
  await invoke(first.win, 'createEntry', 'character', { name: 'Mara', summary: 'A soldier with one hand' })
  await first.close()

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  await expect(second.win.getByRole('heading', { name: 'Create a world' })).toHaveCount(0)
  const reopened = await invoke(second.win, 'getWorld')
  expect(reopened?.id).toBe(world!.id)
  expect(reopened?.name).toBe('Ashgrove')
  const scene = await invoke(second.win, 'getScene', scenes[0].id)
  expect(scene.text).toBe('Mara lost her left hand at the ford.')
  expect(scene.status).toBe('drafted')
  expect((await invoke(second.win, 'listEntries', 'character')).map((e) => e.name)).toEqual(['Mara'])
})
