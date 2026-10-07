// Writes story version 3 (npm run traps:write): a live model writes every scene of story3.ts's outline in order,
// through the app's own Generate (this checkout's app code: the briefing and memory Adam gets), each scene saved and
// read by the memory before the next, as Adam would work. Each scene's planted events go to the writer as the draft's
// direction, never on the card. After each draft the plant is verified: every planted event must really happen (a
// sentence that matches, else one judge call), early ones early, and nothing after them may undo them; and the scene
// must keep to what earlier scenes made true (the guards). A scene that fails is written again, twice at most; then
// the writing stops and says why. Progress is saved after every scene (<story>.partial.json, for --resume), and the
// finished story is frozen with the sentence where each trap became true.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkout, countWords, openApp, whenEnded, type App, type TrapsConfig } from './app'
import { firstBreak, findPlace } from './patterns'
import { paragraphsOf } from './page'
import { quoteInPassage } from './score'
import { GUARDS3, OUTLINE_VERSION, SCENES3, type Scene3 } from './story3'
import { outlineV3, type FixturePlant, type FixtureScene, type StoryFixture } from './storyData'

/** How many times one scene is written at most (the first try and two more). */
export const MOST_TRIES = 3
/** An early event must happen in this first share of the scene. */
const EARLY = 0.34

export interface PlantCheck {
  ok: boolean
  problems: string[]
  plants: FixturePlant[]
}

/** The paragraph a character position of the joined text (paragraphs joined by a blank line) is in. */
export function paragraphAt(paragraphs: string[], at: number): number {
  let start = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const end = start + paragraphs[i].length
    if (at < end + 2) return i
    start = end + 2
  }
  return Math.max(0, paragraphs.length - 1)
}

/**
 * Whether a written scene has its planted events, where and how planned, and keeps to the guards. `judge` answers the
 * questions no sentence settled (good answer "yes"), with quotes; it is only called when needed.
 */
export async function checkPlants(
  scene: Scene3,
  text: string,
  judge: (questions: { id: string; ask: string }[], text: string) => Promise<{ id: string; answer: string; quote: string }[] | null>
): Promise<PlantCheck> {
  const paragraphs = paragraphsOf(text)
  const joined = paragraphs.join('\n\n')
  const problems: string[] = []
  const plants: FixturePlant[] = []
  const found = new Map<string, { start: number; end: number; quote: string; by: 'pattern' | 'judge' }>()
  const ask: { id: string; ask: string; plant: (typeof scene.plants)[number] }[] = []
  for (const p of scene.plants) {
    // A paragraph at a time: a writer spreads one event over a few sentences ("She got the bead out. ... She put it in
    // Pell's hand."), and a sentence-by-sentence search found a later mention instead (round 4).
    const place = findPlace(paragraphs, p.find, p.none ?? [])
    if (place) found.set(p.id, { start: place.start, end: place.end, quote: place.quote, by: 'pattern' })
    else if (p.judge) ask.push({ id: `Q${ask.length + 1}`, ask: p.judge, plant: p })
    else problems.push(`"${p.id}" didn't happen (no paragraph shows it).`)
  }
  if (ask.length) {
    const answers = await judge(
      ask.map(({ id, ask: a }) => ({ id, ask: a })),
      joined
    )
    for (const q of ask) {
      const a = answers?.find((x) => x.id.toUpperCase() === q.id)
      if (!a || a.answer !== 'yes') {
        problems.push(`"${q.plant.id}" didn't happen${answers ? '' : ' (the judge could not be read)'}.`)
        continue
      }
      const para = paragraphs.findIndex((x) => quoteInPassage(x, a.quote))
      if (para < 0) {
        problems.push(`"${q.plant.id}": the judge said yes but its quote isn't in the scene.`)
        continue
      }
      const start = paragraphs.slice(0, para).reduce((t, x) => t + x.length + 2, 0)
      found.set(q.plant.id, { start, end: start + paragraphs[para].length, quote: a.quote, by: 'judge' })
    }
  }
  for (const p of scene.plants) {
    const f = found.get(p.id)
    if (!f) continue
    if (p.early && f.start / Math.max(1, joined.length) > EARLY) problems.push(`"${p.id}" happens too late (it must be in the first third).`)
    if (p.holds) {
      const b = firstBreak(p.holds, joined, f.end)
      if (b) problems.push(`"${p.id}" is undone later in the scene: “${b.text}”`)
    }
    plants.push({ id: p.id, trap: p.trap, scene: scene.key, quote: f.quote, paragraph: paragraphAt(paragraphs, f.start), by: f.by })
  }
  const index = SCENES3.findIndex((s) => s.key === scene.key)
  for (const g of GUARDS3) {
    if (index < SCENES3.findIndex((s) => s.key === g.from) || g.except?.includes(scene.key)) continue
    const b = firstBreak(g.check, joined)
    if (b) problems.push(`breaks "${g.check.id}", true from an earlier scene: “${b.text}”`)
  }
  return { ok: !problems.length, problems, plants }
}

const directionOf = (scene: Scene3): string => scene.plants.map((p) => p.says).join(' ')

export async function runWrite(cfg: TrapsConfig): Promise<{ fixture: StoryFixture; out: string }> {
  if (resolve(cfg.root) !== resolve(cfg.harnessRoot)) {
    throw new Error("The story is written with this checkout's app code (main): leave out --root when writing it.")
  }
  const committed = join(cfg.harnessRoot, 'tests', 'traps', 'story-v3.json')
  const out = resolve(cfg.out ?? committed)
  if (cfg.fake && out === committed) throw new Error('A fake run never writes the real story file: give --out a folder of your own.')
  const partialPath = out.replace(/\.json$/i, '') + '.partial.json'
  const resumeFrom: StoryFixture | null = cfg.resume ? (JSON.parse(readFileSync(cfg.resume, 'utf8')) as StoryFixture) : null
  if (resumeFrom && resumeFrom.outlineVersion !== OUTLINE_VERSION) throw new Error(`${cfg.resume} was written from another outline version.`)
  // Nothing already written is ever written over.
  if (existsSync(out)) throw new Error(`${out} already exists; give another --out.`)
  if (existsSync(partialPath) && resolve(cfg.resume ?? '') !== partialPath) {
    throw new Error(`${partialPath} is there from an earlier try: carry on from it with --resume ${partialPath}, or give another --out.`)
  }

  const startedAt = new Date().toISOString()
  const app: App = await openApp(cfg, outlineV3(), 'The Salt Road (trap story)')
  const scenes: FixtureScene[] = []
  const plants: FixturePlant[] = []
  let stopped: string | undefined
  const fixture = (complete: boolean): StoryFixture => {
    const used = app.budget.usedNow()
    const c = checkout(cfg.root)
    return {
      format: 'aiwrite-trap-story',
      version: 3,
      outlineVersion: OUTLINE_VERSION,
      complete,
      writtenAt: startedAt,
      fake: cfg.fake,
      models: app.models,
      provider: app.providerName,
      app: { root: c.root, branch: c.branch, commit: c.commit, version: c.appVersion },
      story: outlineV3().story,
      chapters: outlineV3().chapters,
      entries: outlineV3().entries,
      scenes,
      plants,
      tokens: { in: used.in, out: used.out, calls: app.usage().total.calls },
      ...(stopped ? { stopped } : {})
    }
  }
  const savePartial = (): void => writeFileSync(partialPath, JSON.stringify(fixture(false), null, 2))

  const judge = async (questions: { id: string; ask: string }[], text: string) =>
    (
      await app.askJudge(
        { facts: ['This is one whole scene of the story, just written.'], checks: questions.map((q) => ({ id: q.id, trap: 'plant', ask: q.ask, bad: 'no' as const })) },
        text
      )
    ).answers

  try {
    for (const scene of SCENES3) {
      const sceneId = app.makeScene(scene)
      const done = resumeFrom?.scenes.find((s) => s.key === scene.key)
      if (done) {
        // Already written: in again as it was, and read by the memory, so what follows builds on the same memory.
        cfg.log(`${scene.key} ${scene.title}: as written before (${done.words} words)`)
        app.save(scene.key, sceneId, done.paragraphs)
        await app.leave(sceneId)
        scenes.push(done)
        plants.push(...(resumeFrom?.plants.filter((p) => p.scene === scene.key) ?? []))
        continue
      }
      let accepted: { paragraphs: string[]; plants: FixturePlant[]; tries: number } | null = null
      const why: string[] = []
      for (let tries = 1; tries <= MOST_TRIES && !accepted; tries++) {
        await app.memoryIdle()
        if (app.budget.hit) break
        cfg.log(`${scene.key} ${scene.title}: writing (try ${tries} of ${MOST_TRIES})`)
        const options = { targetWords: scene.words, creativity: 'balanced' as const, direction: directionOf(scene) }
        let text = ''
        try {
          const { generationId } = await app.aiHandlers.startDraft(sceneId, options)
          const end = await whenEnded<{ status: string; error: string | null }>(generationId)
          if (end.status !== 'complete') {
            why.push(`try ${tries}: the draft ended ${end.status}${end.error ? `: ${end.error}` : ''}`)
            continue
          }
          text = app.gens.getGeneration(app.db, generationId).response
        } catch (e) {
          why.push(`try ${tries}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        const check = await checkPlants(scene, text, judge)
        if (check.ok) accepted = { paragraphs: paragraphsOf(text), plants: check.plants, tries }
        else {
          why.push(`try ${tries}: ${check.problems.join(' ')}`)
          cfg.log(`  not as planned: ${check.problems.join(' ')}`)
        }
      }
      if (!accepted) {
        stopped = app.budget.hit ? app.budget.hit : `scene ${scene.key} ("${scene.title}") wasn't written as planned in ${MOST_TRIES} tries: ${why.join(' | ')}`
        savePartial()
        throw new Error(`Writing stopped: ${stopped} What was written so far is in ${partialPath}.`)
      }
      // In as Adam would accept it; leaving it, the memory reads it before the next scene is written.
      app.save(scene.key, sceneId, accepted.paragraphs)
      await app.leave(sceneId)
      const words = countWords(accepted.paragraphs.join(' '))
      scenes.push({ key: scene.key, chapter: scene.chapter, title: scene.title, card: scene.card, paragraphs: accepted.paragraphs, words, attempts: accepted.tries })
      plants.push(...accepted.plants)
      cfg.log(`  written: ${words} words${accepted.plants.length ? `; ${accepted.plants.map((p) => `${p.id} in paragraph ${p.paragraph + 1}`).join(', ')}` : ''}`)
      savePartial()
    }
    const done = fixture(true)
    writeFileSync(out, JSON.stringify(done, null, 2))
    cfg.log(`tokens used: ${done.tokens.in.toLocaleString('en-GB')} in, ${done.tokens.out.toLocaleString('en-GB')} out, ${done.tokens.calls} calls`)
    cfg.log(`the story is written: ${out} (${scenes.reduce((t, s) => t + s.words, 0).toLocaleString('en-GB')} words; progress file ${partialPath} can go)`)
    return { fixture: done, out }
  } finally {
    const used = app.budget.usedNow()
    if (stopped) cfg.log(`tokens used: ${used.in.toLocaleString('en-GB')} in, ${used.out.toLocaleString('en-GB')} out`)
    await app.close()
  }
}
