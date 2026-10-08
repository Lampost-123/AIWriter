// A large invented world for the desk's speed checks (desk-scale.spec.ts): by default 40 chapters of 5 scenes (200
// scenes) with a few hundred words each, and 150 entries (characters, places, groups, items and lore) whose names turn
// up in the scenes, so the margin, the spine, the board, the gallery and the home all have plenty to draw. Every word is
// made up here; it is built through the app's own API in one call from the window, so it takes a few seconds.
import type { Page } from '@playwright/test'
import type { ID } from '@shared/types'
import { invoke } from './helpers'

export interface LargeWorld {
  storyId: ID
  chapterIds: ID[]
  sceneIds: ID[]
  entryIds: ID[]
}

const FIRST = ['Ada', 'Bram', 'Cass', 'Dov', 'Elsa', 'Fenn', 'Greta', 'Hale', 'Ines', 'Jory', 'Kit', 'Lune', 'Moss', 'Nell', 'Orrin', 'Pell', 'Quill', 'Rook', 'Sabe', 'Tam']
const LAST = ['Ashby', 'Brine', 'Corran', 'Dunmore', 'Ebbing', 'Fairweather', 'Gale', 'Holloway']
const PLACES = ['Saltmarsh', 'Kettle Point', 'the Weir', 'Coldharbour', 'Rook Hill', 'the Narrows', 'Lantern Row', 'Mill End']
const SUFFIX = ['', ' Quay', ' Steps', ' Market', ' Yard']
const SENTENCES = [
  'The tide came in grey and slow, filling the channels one by one until the mudflats shone like hammered tin.',
  'Nobody at the inn would say who had paid for the new rope, though everyone had an opinion about it.',
  'A gull walked the length of the sea wall as if it owned the harbour and had come to collect the rent.',
  'By the second bell the fog had lifted enough to show the far shore, low and dark and closer than it looked.',
  'She kept the letter in her sleeve, where the damp could not reach it and nobody would think to look.',
  'The cart had lost a wheel on the causeway, and three men argued over it while the water crept up the stones.',
  'Somewhere below the cliff a bell was ringing, slow and even, the way it only rang for a ship coming home.',
  'He counted the coins twice and still came out one short, which meant somebody had been in the drawer.'
]

/** Builds the large world in a fresh app (no world open yet) and opens it. Returns its ids. */
export async function makeLargeWorld(
  win: Page,
  opts: { chapters?: number; scenesPerChapter?: number; entries?: number; sentences?: number } = {}
): Promise<LargeWorld> {
  const chapters = opts.chapters ?? 40
  const perChapter = opts.scenesPerChapter ?? 5
  const entries = opts.entries ?? 150
  const sentences = opts.sentences ?? 14
  await invoke(win, 'createWorld', 'Saltmarsh Reach')
  const [story] = await invoke(win, 'listStories')
  const plan = { storyId: story.id, chapters, perChapter, entries, sentences, FIRST, LAST, PLACES, SUFFIX, SENTENCES }
  // One trip into the window: everything is made there, through the same bridge the interface uses.
  return (await win.evaluate(async (p) => {
    const bridge = (globalThis as unknown as { aiwrite: { invoke(m: string, ...a: unknown[]): Promise<{ ok: boolean; value: unknown; error?: { message: string } }> } }).aiwrite
    const call = async <T>(m: string, ...a: unknown[]): Promise<T> => {
      const r = await bridge.invoke(m, ...a)
      if (!r.ok) throw new Error(`${m}: ${r.error?.message}`)
      return r.value as T
    }
    const kinds: [string, number][] = [
      ['character', Math.round(p.entries * 0.4)],
      ['place', Math.round(p.entries * 0.27)],
      ['group', Math.round(p.entries * 0.13)],
      ['item', Math.round(p.entries * 0.1)]
    ]
    kinds.push(['lore', p.entries - kinds.reduce((a, [, n]) => a + n, 0)])
    const names: string[] = []
    const entryIds: string[] = []
    let k = 0
    for (const [kind, n] of kinds) {
      for (let i = 0; i < n; i++, k++) {
        const name =
          kind === 'character'
            ? `${p.FIRST[k % p.FIRST.length]} ${p.LAST[Math.floor(k / p.FIRST.length) % p.LAST.length]}`
            : kind === 'place'
              ? `${p.PLACES[k % p.PLACES.length]}${p.SUFFIX[Math.floor(k / p.PLACES.length) % p.SUFFIX.length]}`
              : kind === 'group'
                ? `The ${p.LAST[k % p.LAST.length]} ${['Guild', 'Watch', 'Company'][k % 3]}`
                : kind === 'item'
                  ? `The ${['brass', 'iron', 'salt-white', 'green'][k % 4]} ${['key', 'compass', 'ledger', 'lantern'][Math.floor(k / 4) % 4]}`
                  : `The ${['Tide', 'Ferry', 'Harbour', 'Bell'][k % 4]} ${['Law', 'Oath', 'Charter', 'Rite'][Math.floor(k / 4) % 4]}`
        const e = await call<{ id: string }>('createEntry', kind, { name: `${name}${names.includes(name) ? ` ${k}` : ''}`, description: `${p.SENTENCES[k % p.SENTENCES.length]} ${p.SENTENCES[(k + 3) % p.SENTENCES.length]}` })
        names.push(name)
        entryIds.push(e.id)
      }
    }
    const outline = await call<{ chapters: { id: string }[]; scenes: { id: string; chapterId: string }[] }>('getOutline', p.storyId)
    const chapterIds = [outline.chapters[0].id]
    for (let c = 1; c < p.chapters; c++) {
      const ch = await call<{ id: string }>('createChapter', p.storyId, { title: `${['The', 'A'][c % 2]} ${p.PLACES[c % p.PLACES.length]} ${['Crossing', 'Watch', 'Tide', 'Reckoning', 'Letter'][c % 5]}` })
      chapterIds.push(ch.id)
    }
    await call('updateChapter', chapterIds[0], { title: 'The First Crossing' })
    const sceneIds: string[] = []
    let s = 0
    for (const chapterId of chapterIds) {
      const have = outline.scenes.filter((x) => x.chapterId === chapterId).map((x) => x.id)
      for (let i = 0; i < p.perChapter; i++, s++) {
        const id = have[i] ?? (await call<{ id: string }>('createScene', chapterId, { title: `${p.SENTENCES[s % p.SENTENCES.length].split(' ').slice(1, 4).join(' ')} ${s + 1}` })).id
        if (have[i]) await call('updateScene', id, { title: `Scene ${s + 1}` })
        const paras: string[] = []
        for (let q = 0; q < 4; q++) {
          const line: string[] = []
          for (let j = 0; j < Math.ceil(p.sentences / 4); j++) line.push(p.SENTENCES[(s * 3 + q * 5 + j) % p.SENTENCES.length])
          // A few of the world's names in each paragraph.
          line.splice(1, 0, `${names[(s * 7 + q) % names.length]} saw it first.`)
          paras.push(line.join(' '))
        }
        await call('saveSceneText', id, null, paras.join('\n\n'))
        if (s % 3 === 0) await call('updateScene', id, { status: s % 2 ? 'done' : 'drafted' })
        sceneIds.push(id)
      }
    }
    return { storyId: p.storyId, chapterIds, sceneIds, entryIds }
  }, plan)) as LargeWorld
}
