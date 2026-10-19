// Events on the timeline at the scene they happen in (Adam, 2026-10-19: "all the events being added by the AI went right
// after the first chapter's scene as a long line"), in the New look's desk, against the fake AI server
// (tests/fake-provider/m4/world.mjs: "The X struck|began ..." is an event, and on a story plan's scene line, that scene).
// After a World build from the story's plan each event follows its scene; and "Put events in their place" moves the
// events an earlier build left at the story's start, with one Undo. Every name here is invented.
import type { Page } from '@playwright/test'
import type { KeepItem } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { expect, invoke, startFake, test, useFakeModel, type LaunchedApp, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const room = (win: Page, name: string) =>
  win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: new RegExp(`^${name}`) })
const river = (win: Page) => win.locator('[data-timeline]')
const offer = (win: Page) => river(win).getByRole('region', { name: 'Put events in their place' })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

/** Three chapters, the second with three scenes, each on its own day. `lines`: a scene's one line, by key. */
const outline = (lines: Record<string, string> = {}): KeepItem[] =>
  [
    { key: 'c1', kind: 'chapter', title: 'Harbour', text: 'Mara comes home.' },
    { key: 's11', kind: 'scene', title: 'Arrival', text: 'Mara Venn steps off the ferry.', parent: { key: 'c1' }, when: 'Day 1' },
    { key: 'c2', kind: 'chapter', title: 'Reefs', text: 'Out past the light.' },
    { key: 's21', kind: 'scene', title: 'Departure', text: 'The boat leaves at dawn.', parent: { key: 'c2' }, when: 'Day 2' },
    { key: 's22', kind: 'scene', title: 'Fog', text: 'Fog comes down on the water.', parent: { key: 'c2' }, when: 'Day 3' },
    { key: 's23', kind: 'scene', title: 'The Wreck', text: 'The boat breaks up on the reef.', parent: { key: 'c2' }, when: 'Day 4' },
    { key: 'c3', kind: 'chapter', title: 'Ashore', text: 'Back on land.' },
    { key: 's31', kind: 'scene', title: 'Home', text: 'The quay is quiet.', parent: { key: 'c3' }, when: 'Day 6' }
  ].map((k) => (lines[k.key] ? { ...k, text: lines[k.key] } : k)) as KeepItem[]

/** A fresh world in the desk whose story has that outline, with the fake AI connected. */
async function world(launch: (o?: LaunchOptions) => Promise<LaunchedApp>, fake: FakeProvider, lines: Record<string, string>) {
  const { win } = await launch({ env: DESK })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'createWorld', 'Gull Harbour')
  await win.reload()
  await expect(win.getByRole('navigation', { name: 'Rooms' })).toBeVisible()
  const [story] = await invoke(win, 'listStories')
  await invoke(win, 'keepOutline', story.id, outline(lines))
  await useFakeModel(win, fake)
  return { win, storyId: story.id as ID }
}

/** Waits for a World build's events, and for the build to end. */
async function built(win: Page, names: string[]): Promise<void> {
  await expect.poll(async () => (await invoke(win, 'listEntries', 'event')).map((e) => e.name).sort(), { timeout: 30_000 }).toEqual([...names].sort())
  await expect.poll(async () => (await invoke(win, 'getWorldBuilder')).running, { timeout: 60_000 }).toBeNull()
}

async function openTimeline(win: Page): Promise<void> {
  await room(win, 'World').click()
  await win.locator('[data-desk-room]').getByRole('button', { name: 'Timeline' }).click()
  await expect(river(win).getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible()
  await expect(river(win).getByRole('list', { name: 'Timeline' }).getByRole('listitem').first()).toBeVisible()
}

/** Where the river shows an event: the scene card just before it ("Ch 2, Sc 3"), other events between them aside. */
async function sceneBefore(win: Page, event: string): Promise<string> {
  const cards = await river(win)
    .locator('[data-card-n]')
    .evaluateAll((els) =>
      els
        .map((e) => ({ n: Number(e.getAttribute('data-card-n')), event: e.hasAttribute('data-event'), label: e.getAttribute('aria-label') ?? '' }))
        .sort((a, b) => a.n - b.n)
    )
  const at = cards.findIndex((c) => c.event && c.label.includes(event))
  if (at < 0) return 'not on the river'
  const scene = cards
    .slice(0, at)
    .reverse()
    .find((c) => !c.event)
  return scene?.label.match(/Ch \d+, Sc \d+/)?.[0] ?? 'before every scene'
}

test('after a World build from the story’s plan, each event sits right after the scene it happens in', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win, storyId } = await world(launch, fake, { s22: 'The Gale began on Day 3.', s23: 'The Storm struck the reef.' })
    expect(await invoke(win, 'buildStoryWorld', { buildId: 'story-build', storyId })).toEqual({ started: true, busy: false })
    await built(win, ['The Gale', 'The Storm'])
    await openTimeline(win)
    await expect.poll(() => sceneBefore(win, 'The Storm')).toBe('Ch 2, Sc 3')
    await expect.poll(() => sceneBefore(win, 'The Gale')).toBe('Ch 2, Sc 2')
    // Nothing waits at the story's start, so there is nothing to offer.
    await expect(offer(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Put events in their place: what an earlier build left at the story’s start goes to its scene, and one Undo puts it back', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win, storyId } = await world(launch, fake, {
      s23: 'The storm drives the boat onto the reef.',
      s31: 'Everyone dances at the wedding.'
    })
    // Built from the author's own summary, as builds before 0.7.7 built a story: true from the story's start.
    await invoke(win, 'startWorldBuild', { buildId: 'old-build', summary: 'The Storm struck at night. The Wedding began at noon.', storyId })
    await built(win, ['The Storm', 'The Wedding'])
    await openTimeline(win)

    // The pile-up: both just after the opening scene, and the offer above the river.
    await expect.poll(() => sceneBefore(win, 'The Storm')).toBe('Ch 1, Sc 1')
    await expect.poll(() => sceneBefore(win, 'The Wedding')).toBe('Ch 1, Sc 1')
    await expect(offer(win)).toContainText('2 events from the World builder can go to the scenes they belong to.')
    await offer(win).getByRole('button', { name: 'Show which' }).click()
    const list = offer(win).getByRole('list', { name: 'Events to move' })
    await expect(list.getByRole('listitem')).toHaveText([
      'The Storm to Ch 2, Sc 3 “The Wreck” · the scene card names it',
      'The Wedding to Ch 3, Sc 1 “Home” · the scene card names it'
    ])
    await expect(list.getByRole('checkbox', { name: /The Storm/ })).toBeChecked()

    await offer(win).getByRole('button', { name: 'Move them' }).click()
    await expect(toasts(win).getByText('Moved 2 events to the scenes they happen in.')).toBeVisible()
    await expect(offer(win)).toHaveCount(0)
    await expect.poll(() => sceneBefore(win, 'The Storm')).toBe('Ch 2, Sc 3')
    await expect.poll(() => sceneBefore(win, 'The Wedding')).toBe('Ch 3, Sc 1')

    // One Undo puts them both back, and the offer with them.
    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => sceneBefore(win, 'The Storm')).toBe('Ch 1, Sc 1')
    await expect.poll(() => sceneBefore(win, 'The Wedding')).toBe('Ch 1, Sc 1')
    await expect(offer(win)).toContainText('2 events from the World builder')

    // Not now: hidden until another event can move.
    await offer(win).getByRole('button', { name: 'Not now' }).click()
    await expect(offer(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
