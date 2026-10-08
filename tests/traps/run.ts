// Runs the trap story through the app's own code, as Adam would use it, and scores what the AI writes.
//
// The app is opened with app.ts. Scenes are written in order through the same calls the window makes (save, leave the
// scene so the memory reads it); at each probe the app is asked to write through the window's own entry points
// (Generate and Add below: the 'startDraft' handler; a beat: 'startBeat'; Continue: 'startEdit'), so the briefing, the
// memory's catch-up and "where things stand" are exactly what Adam gets. What it writes is never saved into the story:
// the next scenes are always the story's own words. The story is version 3 (the long story a live model wrote,
// story-v3.json) unless --story v2 asks for the hand-written one.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkout, countWords, git, openApp, whenEnded, type App, type TrapsConfig } from './app'
import { landedPage, mirrorFixes, paragraphsOf, wordsFrom } from './page'
import {
  passagesMarkdown,
  recallSummary,
  repairDrops,
  reportMarkdown,
  scorePassage,
  summarise,
  summariseRepair,
  type ProbeResult,
  type RepairResult,
  type RunReport,
  type SampleResult
} from './score'
import { promptText, proseMetrics, sampleLines, summariseProse } from './prose'
import type { Probe } from './story'
import { loadFixture, storyV2, storyV3, type StoryData, type StoryScene } from './storyData'
import { storyHash, storyHashes } from './worldCode.mjs'

export { configFromEnv, type TrapsConfig } from './app'

/** The story the run uses. */
export function storyFor(cfg: Pick<TrapsConfig, 'story' | 'storyFile'>): StoryData {
  return cfg.story === 'v2' ? storyV2() : storyV3(loadFixture(cfg.storyFile), cfg.storyFile)
}

/**
 * Which words the story is: version 2's own, or a hash of the written story file with its line endings made LF (so a
 * checkout with core.autocrlf gives the same id as one without; worldCode.mjs).
 */
export const storyId = (cfg: Pick<TrapsConfig, 'story' | 'storyFile'>): string => (cfg.story === 'v2' ? 'story.ts v2' : storyHash(cfg.storyFile))

/** Whether a saved world's story id is this story's: the LF id, or (worlds saved before) the file's own bytes. */
export const storyMatches = (cfg: Pick<TrapsConfig, 'story' | 'storyFile'>, saved: string): boolean =>
  cfg.story === 'v2' ? saved === 'story.ts v2' : storyHashes(cfg.storyFile).includes(saved)

/** What a saved world was saved from: it is only used again for the same checkout, story and models. */
export interface SavedWorld {
  /** The scene the world stops just before (its index in the story, and its key). */
  scene: string
  sceneIndex: number
  story: string
  commit: string
  /** The app code's own version (git's id for the checkout's src folder): the same across harness-only commits. */
  srcTree: string
  /** The world-building code's own id (worldCode.mjs WORLD_CODE); left out by worlds saved before it was kept. */
  worldCode?: string
  /**
   * Uncommitted changes: before worldCode was kept, anywhere in src; since, in the world-building code (or a world
   * built on a relaxed one), and `srcDirty` says whether src had any.
   */
  dirty: boolean
  srcDirty?: boolean
  models: { writer: string; memory: string; judge: string }
  savedAt: string
  /** The scene the memory started reading at (--story-from), when not the first. */
  storyFrom?: string
}

/**
 * A saved world's file and what it was saved from (`path`: the .db file, or a report folder holding one). In a folder,
 * `prefer` picks the world saved before the chain scene ('chain') or before the first probe scene ('probe') when both
 * are there.
 */
export function findSavedWorld(path: string, prefer: 'chain' | 'probe' = 'probe'): { file: string; saved: SavedWorld } {
  const all = existsSync(path) && statSync(path).isDirectory() ? readdirSync(path).filter((f) => /^world-before-.+\.db$/.test(f)).sort() : []
  const pick = all.find((f) => (prefer === 'chain' ? f === 'world-before-chain.db' : f !== 'world-before-chain.db')) ?? all[0]
  const file = existsSync(path) && statSync(path).isDirectory() ? (pick ? join(path, pick) : '') : path
  if (!file || !existsSync(file)) throw new Error(`No saved world at ${path}.`)
  const meta = file.replace(/\.db$/, '.json')
  if (!existsSync(meta)) throw new Error(`${file} has no ${meta} saying what it was saved from.`)
  return { file, saved: JSON.parse(readFileSync(meta, 'utf8')) as SavedWorld }
}

export type Written = Omit<SampleResult, 'judge' | 'results' | 'index'>

/**
 * Step 3's check and repair, the way the page does it as new words land (features/repair/repairRun.ts): the scene
 * saved with the new words in, the main side asked (one memory-model call), the fixes made in the page with the app's
 * own page code, the page telling which it made. Then the scene goes back to how it was before the words landed, and
 * the issues the repair raised are cleared, so every sample starts the same; with `keep` (a chain, where the page goes
 * on), the page keeps the new words as mended and the issues stay, as in the app.
 */
export async function repairLanded(
  app: App,
  scene: Pick<StoryScene, 'key'>,
  sceneId: string,
  before: string[],
  written: { generationId: string | null; text: string },
  o: { keep?: boolean } = {}
): Promise<Omit<RepairResult, 'judge' | 'results'>> {
  const nothing = { checked: false, claims: 0, slips: 0, fixes: [], questions: [], text: written.text }
  const { repairMod, applyMod, db } = app
  if (!repairMod || !written.generationId) return nothing
  const added = paragraphsOf(written.text)
  const all = [...before, ...added]
  const pid = (i: number): string => `t${scene.key}${String(i + 1).padStart(2, '0')}zzzz`.slice(0, 8)
  const issueIds = new Set((db.prepare('SELECT id FROM issues WHERE scene_id = ?').all(sceneId) as { id: string }[]).map((r) => r.id))
  app.save(scene.key, sceneId, all)
  try {
    const page = landedPage(before, added, pid)
    const parts = applyMod
      ? applyMod.landedParts(page.state.doc, page.from, page.state.doc.content.size)
      : added.map((text) => ({ pid: null, text, from: 0, to: text.length }))
    const fromRow = app.lastRow()
    const outcome = await repairMod.repairHandlers.checkNewWords({
      sceneId,
      recordId: written.generationId,
      paragraphs: parts.map(({ text, from, to }) => ({ text, from, to })),
      leadIn: before.join('\n\n').slice(-1_500)
    })
    // What the repair's reply held, and what the app's rules drop from it (the app doesn't report that).
    const call = app.recordsSince(fromRow).find((r) => r.kind === 'repair')
    const rec = call ? app.record(call.id) : null
    const drops = rec ? repairDrops(rec.response, rec.messages, written.text) : undefined
    if (!outcome.repairId) return { ...nothing, ...(drops ? { drops } : {}) }
    let text = written.text
    let made: string[] = []
    if (outcome.fixes.length) {
      if (applyMod) {
        const got = applyMod.fixesTr(page.state, parts, outcome.fixes)
        if (got) {
          made = got.made.map((m) => m.id)
          text = wordsFrom(got.tr.doc, page.before)
        }
      } else {
        const got = mirrorFixes(parts, outcome.fixes)
        made = got.made
        text = got.texts.join('\n\n')
      }
      await repairMod.repairHandlers.repairsApplied(outcome.repairId, made)
    }
    const raised = (db.prepare('SELECT id, status, message FROM issues WHERE scene_id = ?').all(sceneId) as { id: string; status: string; message: string }[]).filter(
      (r) => !issueIds.has(r.id)
    )
    return {
      checked: true,
      claims: outcome.claims,
      slips: outcome.slips,
      fixes: outcome.fixes.map((f) => ({ was: f.was, now: f.now, why: f.why, made: made.includes(f.id) })),
      questions: raised.filter((r) => r.status === 'open').map((r) => r.message),
      text: made.length ? text : written.text,
      ...(drops ? { drops } : {})
    }
  } finally {
    // Back as it was before the words landed, with nothing the repair raised left behind (not in a chain).
    if (!o.keep) {
      const fresh = (db.prepare('SELECT id FROM issues WHERE scene_id = ?').all(sceneId) as { id: string }[]).map((r) => r.id).filter((x) => !issueIds.has(x))
      for (const x of fresh) db.prepare('DELETE FROM issues WHERE id = ?').run(x)
      app.save(scene.key, sceneId, before)
    }
  }
}

/** One sample of a probe, through the window's own entry point. */
export async function writeSample(app: App, cfg: TrapsConfig, probe: Probe, sceneId: string, soFar: string, index: number): Promise<Written> {
  const draft = async (generationId: string): Promise<Written> => {
    const done = await whenEnded<{ status: 'complete' | 'error' | 'stopped'; error: string | null }>(generationId)
    const text = app.gens.getGeneration(app.db, generationId).response
    return { status: done.status, error: done.error, generationId, text, words: countWords(text) }
  }
  // Aimed at its traps the way Adam would aim a draft: his direction for it (probes v2).
  const options = { targetWords: cfg.words.generate, creativity: 'balanced' as const, direction: probe.direction ?? '' }
  if (probe.kind === 'generate') return draft((await app.aiHandlers.startDraft(sceneId, options)).generationId)
  if (probe.kind === 'addBelow') return draft((await app.aiHandlers.startDraft(sceneId, { ...options, targetWords: cfg.words.addBelow, addBelow: true })).generationId)
  if (probe.kind === 'beat') {
    const started = await app.beatsHandlers.startBeat({
      sceneId,
      sessionId: `traps-${probe.id}-${index}`,
      index: probe.beat ?? 1,
      options: { ...options, targetWords: cfg.words.beatScene },
      steer: probe.direction ?? '',
      soFar,
      soFarEnds: probe.soFarEnds ?? 'with-beat'
    })
    return draft(started.generationId)
  }
  const taskId = `traps-${probe.id}-${index}-${Date.now()}`
  const started = await app.startEdit({ taskId, sceneId, tool: 'continue', selection: '', before: soFar, after: '', continueAs: 'paragraph' })
  if (!started.ok) return { status: 'error', error: started.problem, generationId: null, text: '', words: 0 }
  const done = await whenEnded<{ status: 'complete' | 'error' | 'stopped'; error: string | null; text: string }>(taskId)
  return { status: done.status, error: done.error, generationId: started.generationId, text: done.text, words: countWords(done.text) }
}

export async function runTraps(cfg: TrapsConfig): Promise<{ report: RunReport; outDir: string }> {
  // A report already there is never written over.
  if (cfg.out && existsSync(join(cfg.out, 'report.json'))) throw new Error(`${cfg.out} already has a report; give another --out folder.`)
  const data = storyFor(cfg)
  const chosen = data.probes.filter((p) => !cfg.probes || cfg.probes.includes(p.id))
  if (!chosen.length) throw new Error(`No probe called ${cfg.probes?.join(', ')}. The probes are ${data.probes.map((p) => p.id).join(', ')}.`)
  const startedAt = new Date().toISOString()
  const tested = checkout(cfg.root)
  const stamp = startedAt.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
  const outDir = cfg.out ?? join(cfg.harnessRoot, 'traps-results', `${stamp}-${tested.branch.replace(/[^\w.-]+/g, '-')}-${tested.commit.slice(0, 7)}${cfg.fake ? '-fake' : ''}`)
  const sceneIndex = (key: string): number => data.scenes.findIndex((s) => s.key === key)
  const firstProbe = Math.min(...chosen.map((p) => sceneIndex(p.scene)))
  const lastScene = Math.max(...chosen.map((p) => sceneIndex(p.scene)))
  const story = storyId(cfg)
  const srcTree = git(cfg.root, ['rev-parse', 'HEAD:src'])

  // A saved world from an earlier run of the same checkout and story: the memory build up to it is not done again.
  const from = cfg.fromWorld ? findSavedWorld(cfg.fromWorld) : null
  if (from) {
    const s = from.saved
    if (!storyMatches(cfg, s.story)) throw new Error(`The saved world ${from.file} was made with another story; it can't be used for this one.`)
    if (s.srcTree !== srcTree || !srcTree || s.dirty || s.srcDirty || tested.dirty) {
      throw new Error(
        `The saved world ${from.file} was made with other app code (${s.commit.slice(0, 9)}${s.dirty ? ', with uncommitted changes' : ''}) than this checkout's (${tested.commit.slice(0, 9)}${tested.dirty ? ', with uncommitted changes' : ''}): build it again for this checkout.`
      )
    }
    if (firstProbe < s.sceneIndex) throw new Error(`The saved world stops before ${s.scene}, after the first probe's scene; build it again (leave out --from-world).`)
  }

  cfg.log(`story: ${data.source}${data.probesVersion ? `, probes v${data.probesVersion}` : ''}`)
  const app = await openApp(cfg, data, `${data.story.title} (trap story)`, from?.file ?? null)
  let stopped: string | undefined
  let savedWorld: string | undefined
  const evidence: ProbeResult[] = []
  try {
    if (from) {
      if (JSON.stringify(from.saved.models) !== JSON.stringify(app.models)) throw new Error(`The saved world ${from.file} was built with other models (${JSON.stringify(from.saved.models)}).`)
      const titles = data.scenes.slice(0, from.saved.sceneIndex).map((s) => s.title)
      if (JSON.stringify(app.existing.map((s) => s.title)) !== JSON.stringify(titles)) throw new Error(`The saved world ${from.file} doesn't hold the story's scenes up to ${from.saved.scene}.`)
      cfg.log(`started from the saved world ${from.file} (scenes up to ${from.saved.scene} already read)`)
    }
    const probeResults: ProbeResult[] = evidence
    scenes: for (const [si, scene] of data.scenes.entries()) {
      if (si > lastScene) break
      if (from && si < from.saved.sceneIndex) continue
      if (si === firstProbe && cfg.saveWorld && !from) {
        // The world just before the first probe scene, so a later run (new probes, more samples) can start here.
        await app.memoryIdle()
        mkdirSync(outDir, { recursive: true })
        const file = join(outDir, `world-before-${scene.key}.db`)
        if (!existsSync(file)) {
          await app.snapshot(file)
          const meta: SavedWorld = { scene: scene.key, sceneIndex: si, story, commit: tested.commit, srcTree, dirty: tested.dirty, models: app.models, savedAt: new Date().toISOString() }
          writeFileSync(file.replace(/\.db$/, '.json'), JSON.stringify(meta, null, 2))
          savedWorld = file
          cfg.log(`world saved before ${scene.key}: ${file}`)
        }
      }
      const sceneId = app.makeScene(scene)
      const here = chosen.filter((p) => p.scene === scene.key).sort((a, b) => a.paragraphs - b.paragraphs)
      for (const probe of here) {
        // Aimed at its traps the way Adam would aim Continue: the scene card's beats (probes v2).
        if (probe.beats) app.setBeats(sceneId, probe.beats)
        const soFarParas = scene.paragraphs.slice(0, probe.paragraphs)
        if (soFarParas.length) app.save(scene.key, sceneId, soFarParas)
        const soFar = soFarParas.join('\n\n')
        const result: ProbeResult = { id: probe.id, scene: scene.key, kind: probe.kind, asks: probe.asks, ...(probe.note ? { note: probe.note } : {}), samples: [] }
        probeResults.push(result)
        if (probe.note) cfg.log(`probe ${probe.id}: ${probe.note}`)
        // Step 5: the search index caught up and read for meaning before the probe, so its briefings really search.
        await app.memoryIdle()
        const recall = await app.recallReady()
        if (recall.available) {
          result.recall = recall
          cfg.log(
            `probe ${probe.id}: find by meaning ${recall.meaning ? `on (${recall.engine ?? '?'}), ${recall.indexed?.done ?? 0} of ${recall.indexed?.total ?? 0} passages read` : 'off'}${recall.note ? `; ${recall.note}` : ''}`
          )
        }
        for (let i = 0; i < cfg.samples; i++) {
          await app.memoryIdle()
          if (app.budget.hit) {
            stopped = app.budget.hit
            break scenes
          }
          cfg.log(`probe ${probe.id} (${probe.kind}, ${scene.title}) sample ${i + 1}/${cfg.samples}`)
          const fromRow = app.lastRow()
          let written: Written
          try {
            written = await writeSample(app, cfg, probe, sceneId, soFar, i)
          } catch (e) {
            written = { status: 'error', error: e instanceof Error ? e.message : String(e), generationId: null, text: '', words: 0 }
          }
          if (written.status !== 'complete' || !written.text.trim()) {
            cfg.log(`  not written: ${written.error ?? written.status}`)
            result.samples.push({ ...written, status: written.status === 'complete' ? 'error' : written.status, error: written.error ?? 'Nothing was written.', index: i, judge: { status: 'skipped', raw: '' }, results: [] })
            result.samples.push({ ...result.samples.pop()!, records: app.recordsSince(fromRow) })
            continue
          }
          const j = await app.askJudge(probe, written.text, { direction: probe.direction ?? null })
          const results = scorePassage(probe, written.text, j.answers)
          // The prose check: against the page before it and the writer's own prompt, with the judge's marks.
          const record = written.generationId ? app.record(written.generationId) : null
          const target = probe.kind === 'generate' ? cfg.words.generate : probe.kind === 'addBelow' ? cfg.words.addBelow : probe.kind === 'beat' ? cfg.words.beatScene : null
          const prose = { ...proseMetrics({ text: written.text, before: soFar, target, samples: record ? sampleLines(promptText(record.messages)) : [] }), ...(j.prose ? { rubric: j.prose } : {}) }
          const sample: SampleResult = { ...written, index: i, judge: { status: j.status, raw: j.raw, ...(j.asked ? { asked: j.asked } : {}) }, results, prose }
          cfg.log(`  ${written.words} words; ${results.map((r) => `${r.id} ${r.verdict}`).join(', ')}`)
          if (app.repairMod) {
            let landed: Omit<RepairResult, 'judge' | 'results'>
            try {
              landed = await repairLanded(app, scene, sceneId, soFarParas, written)
            } catch (e) {
              cfg.log(`  check and repair failed: ${e instanceof Error ? e.message : String(e)}`)
              landed = { checked: false, claims: 0, slips: 0, fixes: [], questions: [], text: written.text }
            }
            // The repaired passage is judged again only when the page changed it.
            const again = landed.text !== written.text ? await app.askJudge(probe, landed.text) : null
            sample.repair = {
              ...landed,
              judge: again ? { status: again.status, raw: again.raw } : sample.judge,
              results: landed.text !== written.text ? scorePassage(probe, landed.text, again?.answers ?? null) : results
            }
            cfg.log(
              `  repair: ${landed.checked ? `${landed.claims} claims, ${landed.fixes.length} fixes (${landed.fixes.filter((f) => f.made).length} made), ${landed.questions.length} questions` : 'checked nothing'}${landed.text !== written.text ? `; after: ${sample.repair.results.map((r) => `${r.id} ${r.verdict}`).join(', ')}` : ''}`
            )
          }
          // Which of the app's records this sample made (the writer's, a plan, where things stand, the repair...).
          sample.records = app.recordsSince(fromRow)
          result.samples.push(sample)
        }
      }
      // The scene as written; leaving it, the memory reads it before the story goes on.
      if (scene.paragraphs.length) {
        app.save(scene.key, sceneId, scene.paragraphs)
        await app.leave(sceneId)
      }
      if (app.budget.hit) {
        stopped = app.budget.hit
        break
      }
    }
    await app.memoryIdle()
    if (!stopped && app.budget.hit) stopped = app.budget.hit

    const used = app.budget.usedNow()
    const report: RunReport = {
      storyVersion: data.version,
      ...(data.probesVersion ? { probesVersion: data.probesVersion } : {}),
      ...(savedWorld || from ? { world: { ...(savedWorld ? { saved: savedWorld } : {}), ...(from ? { from: from.file } : {}) } } : {}),
      storySource: data.source,
      traps: data.traps.map(({ id, name }) => ({ id, name })),
      ...(stopped ? { stopped } : {}),
      budget: { maxIn: cfg.maxIn, maxOut: cfg.maxOut, usedIn: used.in, usedOut: used.out },
      startedAt,
      finishedAt: new Date().toISOString(),
      fake: cfg.fake,
      tested,
      harness: { root: cfg.harnessRoot, commit: git(cfg.harnessRoot, ['rev-parse', 'HEAD']) || 'unknown' },
      provider: app.providerName,
      prices: cfg.prices,
      models: app.models,
      samples: cfg.samples,
      words: cfg.words,
      probes: probeResults,
      usage: app.usage(),
      summary: summarise(probeResults, 'written', data.traps),
      prose: summariseProse(probeResults.flatMap((p) => p.samples.filter((s) => s.prose).map((s) => ({ where: `${p.id} sample ${s.index + 1} (${p.kind})`, kind: p.kind, text: s.text, prose: s.prose! })))),
      ...(probeResults.some((x) => x.recall) ? { recall: recallSummary(probeResults) } : {}),
      evidence: { world: join(outDir, 'evidence-world.db'), index: join(outDir, 'evidence-index.json') },
      ...(app.repairMod ? { repaired: summariseRepair(probeResults, data.traps) } : {})
    }

    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(outDir, 'report.md'), reportMarkdown(report))
    writeFileSync(join(outDir, 'passages.md'), passagesMarkdown(report))
    if (stopped) cfg.log(`stopped before the end: ${stopped}`)
    cfg.log(`tokens used: ${used.in.toLocaleString('en-GB')} in, ${used.out.toLocaleString('en-GB')} out`)
    cfg.log(`report written to ${outDir}`)
    return { report, outDir }
  } finally {
    // The evidence, always (a run that stopped or failed too): every record the run made, with what was sent and what
    // came back, and which records belong to which sample. The throwaway data folder goes after this.
    try {
      mkdirSync(outDir, { recursive: true })
      const world = join(outDir, 'evidence-world.db')
      if (!existsSync(world)) await app.saveEvidence(world)
      const index = join(outDir, 'evidence-index.json')
      if (!existsSync(index)) {
        writeFileSync(
          index,
          JSON.stringify(
            {
              note: "Record ids are rows of the generations table in evidence-world.db (messages_json is what was sent, response what came back). Judge calls aren't the app's: report.json has each one's question (judge.asked) and reply (judge.raw).",
              probes: evidence.map((p) => ({ probe: p.id, scene: p.scene, samples: p.samples.map((m) => ({ sample: m.index + 1, records: m.records ?? [] })) }))
            },
            null,
            2
          )
        )
      }
      cfg.log(`evidence saved: ${world}`)
    } catch (e) {
      cfg.log(`could not save the evidence: ${e instanceof Error ? e.message : String(e)}`)
    }
    await app.close()
  }
}
