// The consistency reports: repetition on ordinary prose and on prose that leans on a word or phrase, pet
// phrases across chapters, names left alone, story order and live scenes only, speed on a long story,
// and plot threads open too long or paid off with no setup (on the fixed test world, tests/unit/testWorld.ts).
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { ID, SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import type { ChapterText } from '../db/checksReports'
import { LONG_OPEN_CHAPTERS } from '../worldViews/threads'
import { buildRepetition, nameWordsOf, repetitionReportOf, threadsReportOf, WORD_EVERY } from './reports'

// Ordinary prose, written for these tests: about 1,100 words in three scenes, names used freely.
const SCENES = [
  `The ferry left Harrowgate an hour before dawn, and Mara stood at the rail with her collar turned up against the wind. The river was
wide here, brown and slow, carrying branches and the odd drowned crate down from the hills. Behind her the town shrank to a smudge of
lamps. She had not slept. Every time she closed her eyes she saw the mill burning, the roof folding in on itself like wet paper.

Tobin found her there with two cups of tea that had gone lukewarm on the walk from the galley. He handed her one without a word and
leaned beside her, elbows on the rail. For a while neither of them spoke. Gulls wheeled over the wake, crying at nothing.

"You think he'll be waiting," Tobin said at last.

"I know he will." Mara blew across the cup out of habit. "Kell never misses a chance to be proved right."

"He wasn't right about the mill."

"He was right that someone would burn it. He just didn't say who." She drank, grimaced, and poured the rest over the side. "That's the
trouble with Kell. He tells you half of a thing and lets you find the other half the hard way."

The deckhand rang the bell for the narrows. Tobin straightened and looked downriver, where the banks drew in and the current quickened
between grey stones. A heron lifted from the reeds and flapped away, unhurried, as if the boat were beneath its notice.`,

  `They reached the landing at Corran's Ford by mid-morning. The village was smaller than Mara remembered: a chapel with a crooked spire,
a smithy, a row of cottages whose gardens ran down to the water. Smoke rose from a single chimney. Somewhere a dog was barking, the same
two notes over and over, patient and hopeless.

Kell was sitting on an upturned boat at the end of the jetty, whittling a stick into nothing. He did not look up when the ferry bumped
against the posts. He waited until Mara had climbed the ladder and was standing over him, and then he folded the knife and put it away.

"You took your time," he said.

"The river took its time. I came as fast as it let me."

He smiled at that, the thin smile she had learned to distrust as a girl. His hair had gone grey at the temples since the winter, and there
was a new scar along his jaw, pink and shiny. He saw her looking and touched it with one finger.

"A misunderstanding," he said. "Settled now."

Tobin came up behind her with the bags. Kell gave him a long, measuring stare, then nodded as if a question had been answered. "Bring
those up to the house. Ennis will show you where." He stood, brushing shavings from his coat. "Mara and I are going to walk."

They walked along the bank, away from the village, past willows trailing their fingers in the shallows. The path was muddy from the
week's rain and Mara had to pick her way between puddles. Kell went straight through them, careless of his boots.

"Ask," he said, when the cottages were out of sight.

"Who burned it?"

"Wrong question." He stopped and turned to face her. "Ask me why."`,

  `The house stood on a rise above the ford, square and plain, its shutters painted a green that had faded almost to white. Inside it
smelled of woodsmoke and old paper. Ennis, a stooped woman with ink-stained hands, had laid a fire in the front room and set out bread,
a wedge of yellow cheese and a jug of cider. Tobin had already eaten half the bread by the time Mara and Kell came in from the cold.

Mara sat by the hearth and held her hands to the flames until feeling crept back into her fingers. Kell did not sit. He paced the length
of the room, from the window to the bookcase and back, while the light outside turned the colour of pewter.

"There was a ledger," he said. "Your father kept it. Every sack of grain that came through the mill, every coin that changed hands. He
wrote it all down in a little red book, and he kept that book in a tin box under the third stair."

"I know the box," Mara said slowly. "I never knew what was in it."

"Nobody did. That was the point." Kell picked up a candle, looked at it, put it down again. "Somebody found out. Somebody who did not want
those numbers read aloud in front of the magistrate. And the easiest way to lose one small book is to lose the building around it."

Tobin had stopped eating. "Then it's gone. The ledger burned with everything else."

"Did it?" Kell turned from the window. In the firelight his face was all hollows. "Your father was a careful man, Mara. Careful men make
copies."

Outside, the dog in the village had finally fallen quiet. Mara listened to the fire settle and spit, and to the rain beginning again on
the roof, soft at first and then steady. She thought of the tin box, and of her father's hands, square and patient, writing by lamplight
long after everyone else had gone to bed.

"Where?" she said.

Kell only smiled.`
]

const NAMES = nameWordsOf(['Mara', 'Tobin', 'Kell', 'Ennis', 'Harrowgate', "Corran's Ford"])

const chapter = (id: string, ...texts: string[]): ChapterText => ({
  chapterId: id,
  title: `Chapter ${id}`,
  scenes: texts.map((text, i) => ({ sceneId: `${id}.s${i + 1}`, text }))
})

const report = (...chapters: ChapterText[]) => buildRepetition({ storyId: 'story', chapters, names: NAMES })
const phrases = (items: { phrase: string }[]): string[] => items.map((i) => i.phrase)

describe('the repetition report', () => {
  it('gives ordinary prose a short list at most, and never a name', () => {
    const r = report(chapter('c1', ...SCENES))
    expect(r.chapters).toHaveLength(1)
    expect(r.chapters[0].items.length).toBeLessThanOrEqual(2)
    for (const p of phrases(r.chapters[0].items)) expect(p).not.toMatch(/mara|tobin|kell|ennis|harrowgate|corran/)
    expect(r.petPhrases).toEqual([])
  })

  it('flags a word and a phrase a chapter leans on, the phrase whole rather than its parts', () => {
    const crutch = Array.from(
      { length: 9 },
      (_, i) => `Suddenly the ${['door', 'lamp', 'wind', 'dog', 'boat', 'gate', 'bell', 'fire', 'roof'][i]} moved. Mara took a deep breath.`
    ).join(' ')
    const r = report(chapter('c1', ...SCENES, crutch))
    const items = r.chapters[0].items
    expect(phrases(items)).toContain('suddenly')
    expect(phrases(items)).toContain('took a deep breath')
    expect(phrases(items)).not.toContain('deep breath')
    expect(phrases(items)).not.toContain('breath')
    expect(items.find((i) => i.phrase === 'suddenly')).toMatchObject({ count: 9, chapterIds: ['c1'], sceneId: 'c1.s4' })
  })

  it('asks more of a long chapter before a word counts as too often', () => {
    const filler = SCENES.join('\n\n')
    const words = filler.split(/\s+/).length
    // Eight uses in one scene is too many there; spread through a chapter ten times as long, it isn't.
    const eight = ['swung', 'dimmed', 'flared', 'guttered', 'rocked', 'hissed', 'steadied', 'glowed'].map((v) => `The lantern ${v}.`).join(' ')
    expect(phrases(report(chapter('c1', SCENES[0], eight)).chapters[0].items)).toContain('lantern')
    const long = Array.from({ length: Math.ceil((8 * WORD_EVERY) / words) + 1 }, () => filler)
    expect(phrases(report(chapter('c1', ...long, eight)).chapters[0].items)).not.toContain('lantern')
  })

  it('keeps each chapter to a short list, the most overused first', () => {
    const many = ['harbour', 'silver', 'thunder', 'meadow', 'candle', 'orchard', 'saddle', 'window', 'blanket', 'cellar']
      .map((w, i) => `${w}. `.repeat(10 + i))
      .join('')
    const items = report(chapter('c1', many)).chapters[0].items
    expect(items).toHaveLength(8)
    expect(items[0]).toMatchObject({ phrase: 'cellar', count: 19 })
    expect(phrases(items)).not.toContain('harbour')
  })

  it('finds pet phrases in three chapters or more, never across a name or a sentence', () => {
    const habit = (n: number) => `Mara gave him the ghost of a smile and looked away. Tobin shook his head slowly. Rain. ${n}`
    const r = report(chapter('c1', SCENES[0], habit(1)), chapter('c2', SCENES[1], habit(2)), chapter('c3', SCENES[2], habit(3)), chapter('c4', 'Quiet.'))
    const pet = r.petPhrases.find((p) => p.phrase === 'ghost of a smile')
    expect(pet).toMatchObject({ count: 3, chapterIds: ['c1', 'c2', 'c3'], sceneId: 'c1.s2' })
    expect(phrases(r.petPhrases)).toContain('shook his head slowly')
    // The shorter phrases inside them, in the same chapters, aren't listed again.
    expect(phrases(r.petPhrases)).not.toContain('shook his head')
    for (const p of phrases(r.petPhrases)) expect(p).not.toMatch(/mara|tobin|rain/)
  })

  it('needs a phrase in three chapters to call it a pet phrase', () => {
    const habit = 'She gave him the ghost of a smile.'
    expect(report(chapter('c1', habit), chapter('c2', habit), chapter('c3', 'Nothing here.')).petPhrases).toEqual([])
  })

  it('asks a long story for a phrase in one chapter in ten', () => {
    const habit = 'She gave him the ghost of a smile.'
    const chapters = Array.from({ length: 50 }, (_, i) => chapter(`c${i + 1}`, i < 4 ? habit : 'Nothing much.'))
    expect(report(...chapters).petPhrases).toEqual([])
    chapters[10] = chapter('c11', habit)
    expect(phrases(report(...chapters).petPhrases)).toContain('ghost of a smile')
  })

  it('reads a story’s live chapters and scenes in order, leaving out the world’s names', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const first = repo.getOutline(db, story.id).chapters[0]
    const second = repo.createChapter(db, story.id, { title: 'The ford' })
    const gone = repo.createChapter(db, story.id, { title: 'Cut' })
    const write = (chapterId: ID, text: string, afterId?: ID): ID => {
      const scene = repo.createScene(db, chapterId, { afterId })
      repo.saveSceneText(db, scene.id, null, text)
      return scene.id
    }
    repo.createEntry(db, 'character', { name: 'Oriel Vane', aliases: ['The Widow'] })
    const lean = 'The widow lowered the lantern. Oriel lowered the lantern again. '.repeat(5)
    const kept = write(second.id, lean)
    const cut = write(second.id, 'The orchard burned. '.repeat(12))
    repo.deleteScene(db, cut)
    write(gone.id, 'The cellar flooded. '.repeat(12))
    repo.deleteChapter(db, gone.id)
    const r = repetitionReportOf(db, story.id)
    expect(r.chapters.map((c) => c.chapterId)).toEqual([first.id, second.id])
    expect(r.chapters[1].title).toBe('The ford')
    const items = phrases(r.chapters[1].items)
    expect(items).toContain('lowered the lantern')
    expect(items.join(' ')).not.toMatch(/oriel|widow|orchard|cellar/)
    expect(r.chapters[1].items.find((i) => i.phrase === 'lowered the lantern')?.sceneId).toBe(kept)
  })

  it('stays quick on a 100,000-word story', () => {
    const db = memoryWorld('Long')
    const story = repo.listStories(db)[0]
    let seed = 7
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const vocab = Array.from({ length: 3000 }, (_, i) => `w${i.toString(36)}x`.replace(/\d/g, (d) => 'abcdefghij'[+d]))
    const common = ['the', 'and', 'she', 'was', 'of', 'to', 'a', 'in', 'he', 'it', 'his', 'her', 'had', 'with']
    const sentence = (): string => {
      const n = 6 + Math.floor(rnd() * 12)
      const w: string[] = []
      for (let i = 0; i < n; i++) w.push(rnd() < 0.45 ? common[Math.floor(rnd() * common.length)] : vocab[Math.floor(Math.pow(rnd(), 2) * vocab.length)])
      return w.join(' ') + (rnd() < 0.3 ? ', ' : '. ')
    }
    let words = 0
    db.transaction(() => {
      let chapterId = repo.getOutline(db, story.id).chapters[0].id
      for (let c = 0; c < 40; c++) {
        if (c > 0) chapterId = repo.createChapter(db, story.id).id
        for (let s = 0; s < 5; s++) {
          let text = ''
          while (text.split(' ').length < 500) text += sentence()
          words += text.split(' ').length
          const scene = repo.createScene(db, chapterId)
          repo.saveSceneText(db, scene.id, null, text)
        }
      }
    })()
    expect(words).toBeGreaterThan(100_000)
    // Timed three times, each just after a write so nothing kept can be reused; the fastest run is what
    // the code itself costs and the least shaken by other work on a busy test machine.
    const times: number[] = []
    let r = repetitionReportOf(db, story.id)
    for (let i = 0; i < 3; i++) {
      repo.setMeta(db, 'perf_test', String(i))
      const t0 = performance.now()
      r = repetitionReportOf(db, story.id)
      times.push(performance.now() - t0)
    }
    expect(r.chapters).toHaveLength(40)
    expect(Math.min(...times)).toBeLessThan(1500)
    // Asked again with nothing changed, it is kept.
    const t1 = performance.now()
    expect(repetitionReportOf(db, story.id)).toBe(r)
    expect(performance.now() - t1).toBeLessThan(20)
  }, 60_000)
})

describe('the plot threads report', () => {
  function world() {
    const w = dbWorld()
    const { db } = w
    const thread = (name: string) => repo.createEntry(db, 'thread', { name })
    const card = (key: string, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, w.id(key), { ...emptySceneCard(), ...c })
    return { ...w, thread, card, report: (story: string) => threadsReportOf(db, w.id(story)) }
  }

  it(`lists threads open ${LONG_OPEN_CHAPTERS} chapters or more, as the board does, with where each was set up`, () => {
    const w = world()
    // "Who burned the mill?" is opened in Book 1, Ch 1, Sc 2: four chapters by Book 1's end, fourteen by Book 2's.
    expect(w.report('b1').openTooLong).toEqual([])
    expect(w.report('b2').openTooLong).toEqual([
      {
        entryId: w.id('burned'),
        name: 'Who burned the mill?',
        openedIn: 'Book 1, Ch 1, Sc 2',
        chapters: 14,
        openedAt: { storyId: w.id('b1'), sceneId: w.id('b1.c1.s2') }
      }
    ])
  })

  it('lists a payoff with nothing setting it up before it, once, at the first such scene', () => {
    const w = world()
    const map = w.thread('The lost map')
    w.card('b1.c2.s2', { paysOffIds: [map.id] })
    w.card('b1.c3.s1', { paysOffIds: [map.id] })
    expect(w.report('b1').noSetup).toEqual([{ entryId: map.id, name: 'The lost map', sceneId: w.id('b1.c2.s2'), label: 'Book 1, Ch 2, Sc 2' }])
  })

  it('counts a setup on an earlier card, or the memory opening the thread, but not one in the same scene or after', () => {
    const w = world()
    const early = w.thread('Set up early')
    const same = w.thread('Set up in the same scene')
    const late = w.thread('Set up later')
    const opened = w.thread('Opened in the text')
    w.card('b1.c1.s1', { setsUpIds: [early.id] })
    w.card('b1.c2.s1', { setsUpIds: [same.id], paysOffIds: [early.id, same.id, late.id, opened.id] })
    w.card('b1.c3.s1', { setsUpIds: [late.id] })
    mem.insertChange(w.db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: opened.id, anchor: 'scene', sceneId: w.id('b1.c1.s2'), origin: 'adam' })
    expect(w.report('b1').noSetup.map((n) => n.name)).toEqual(['Set up in the same scene', 'Set up later'])
    // "Who burned the mill?", paid off on Book 1's Ch 3, Sc 2 card, was opened in Ch 1: nothing to say.
    expect(w.report('b1').noSetup.some((n) => n.entryId === w.id('burned'))).toBe(false)
  })

  it('counts a setup anywhere on the story’s line, a side story added before the payoff included', () => {
    const w = world()
    const road = w.thread('The road north')
    // Kell's Road runs during Book 1 and is added to its line after Ch 2, so it comes before Ch 3.
    w.card('kr.c1.s1', { setsUpIds: [road.id] })
    w.card('b1.c3.s1', { paysOffIds: [road.id] })
    expect(w.report('b1').noSetup).toEqual([])
    // Ember, during Book 2, has all of Book 1 (Kell's Road with it) on its line before it starts.
    w.card('ember.c1.s1', { paysOffIds: [road.id] })
    expect(w.report('ember').noSetup).toEqual([])
    // A payoff in another story is that story's to report.
    const lone = w.thread('Nobody set this up')
    w.card('b2.c1.s1', { paysOffIds: [lone.id] })
    expect(w.report('b1').noSetup).toEqual([])
    expect(w.report('b2').noSetup.map((n) => n.name)).toEqual(['Nobody set this up'])
  })

  it('leaves out payoffs of threads that have gone to Recently deleted', () => {
    const w = world()
    const gone = w.thread('Gone')
    w.card('b1.c2.s1', { paysOffIds: [gone.id] })
    repo.deleteEntry(w.db, gone.id)
    expect(w.report('b1').noSetup).toEqual([])
  })
})
