// Runs the trap story through the app's own code, as Adam would use it, and scores what the AI writes.
//
// The app is opened with app.ts. Scenes are written in order through the same calls the window makes (save, leave the
// scene so the memory reads it); at each probe the app is asked to write through the window's own entry points
// (Generate and Add below: the 'startDraft' handler; a beat: 'startBeat'; Continue: 'startEdit'), so the briefing, the
// memory's catch-up and "where things stand" are exactly what Adam gets. What it writes is never saved into the story:
// the next scenes are always the story's own words. The story is version 3 (the long story a live model wrote,
// story-v3.json) unless --story v2 asks for the hand-written one.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkout, countWords, git, openApp, whenEnded, type App, type TrapsConfig } from './app'
import { landedPage, mirrorFixes, paragraphsOf, wordsFrom } from './page'
import {
  passagesMarkdown,
  reportMarkdown,
  scorePassage,
  summarise,
  summariseRepair,
  type ProbeResult,
  type RepairResult,
  type RunReport,
  type SampleResult
} from './score'
import type { Probe } from './story'
import { loadFixture, storyV2, storyV3, type StoryData, type StoryScene } from './storyData'

export { configFromEnv, type TrapsConfig } from './app'

/** The story the run uses. */
export function storyFor(cfg: Pick<TrapsConfig, 'story' | 'storyFile'>): StoryData {
  return cfg.story === 'v2' ? storyV2() : storyV3(loadFixture(cfg.storyFile), cfg.storyFile)
}

type Written = Omit<SampleResult, 'judge' | 'results' | 'index'>

/**
 * Step 3's check and repair, the way the page does it as new words land (features/repair/repairRun.ts): the scene
 * saved with the new words in, the main side asked (one memory-model call), the fixes made in the page with the app's
 * own page code, the page telling which it made. Then the scene goes back to how it was before the words landed, and
 * the issues the repair raised are cleared, so every sample starts the same.
 */
async function repairLanded(app: App, scene: StoryScene, sceneId: string, before: string[], written: { generationId: string | null; text: string }): Promise<Omit<RepairResult, 'judge' | 'results'>> {
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
    const outcome = await repairMod.repairHandlers.checkNewWords({
      sceneId,
      recordId: written.generationId,
      paragraphs: parts.map(({ text, from, to }) => ({ text, from, to })),
      leadIn: before.join('\n\n').slice(-1_500)
    })
    if (!outcome.repairId) return nothing
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
      text: made.length ? text : written.text
    }
  } finally {
    // Back as it was before the words landed, with nothing the repair raised left behind.
    const fresh = (db.prepare('SELECT id FROM issues WHERE scene_id = ?').all(sceneId) as { id: string }[]).map((r) => r.id).filter((x) => !issueIds.has(x))
    for (const x of fresh) db.prepare('DELETE FROM issues WHERE id = ?').run(x)
    app.save(scene.key, sceneId, before)
  }
}

/** One sample of a probe, through the window's own entry point. */
async function writeSample(app: App, cfg: TrapsConfig, probe: Probe, sceneId: string, soFar: string, index: number): Promise<Written> {
  const draft = async (generationId: string): Promise<Written> => {
    const done = await whenEnded<{ status: 'complete' | 'error' | 'stopped'; error: string | null }>(generationId)
    const text = app.gens.getGeneration(app.db, generationId).response
    return { status: done.status, error: done.error, generationId, text, words: countWords(text) }
  }
  const options = { targetWords: cfg.words.generate, creativity: 'balanced' as const, direction: '' }
  if (probe.kind === 'generate') return draft((await app.aiHandlers.startDraft(sceneId, options)).generationId)
  if (probe.kind === 'addBelow') return draft((await app.aiHandlers.startDraft(sceneId, { ...options, targetWords: cfg.words.addBelow, addBelow: true })).generationId)
  if (probe.kind === 'beat') {
    const started = await app.beatsHandlers.startBeat({
      sceneId,
      sessionId: `traps-${probe.id}-${index}`,
      index: probe.beat ?? 1,
      options: { ...options, targetWords: cfg.words.beatScene },
      steer: '',
      soFar,
      soFarEnds: 'with-beat'
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
  cfg.log(`story: ${data.source}`)
  const app = await openApp(cfg, data, `${data.story.title} (trap story)`)
  let stopped: string | undefined
  try {
    const probeResults: ProbeResult[] = []
    const lastScene = Math.max(...chosen.map((p) => data.scenes.findIndex((s) => s.key === p.scene)))
    scenes: for (const [si, scene] of data.scenes.entries()) {
      if (si > lastScene) break
      const sceneId = app.makeScene(scene)
      const here = chosen.filter((p) => p.scene === scene.key).sort((a, b) => a.paragraphs - b.paragraphs)
      for (const probe of here) {
        const soFarParas = scene.paragraphs.slice(0, probe.paragraphs)
        if (soFarParas.length) app.save(scene.key, sceneId, soFarParas)
        const soFar = soFarParas.join('\n\n')
        const result: ProbeResult = { id: probe.id, scene: scene.key, kind: probe.kind, asks: probe.asks, ...(probe.note ? { note: probe.note } : {}), samples: [] }
        probeResults.push(result)
        if (probe.note) cfg.log(`probe ${probe.id}: ${probe.note}`)
        for (let i = 0; i < cfg.samples; i++) {
          await app.memoryIdle()
          if (app.budget.hit) {
            stopped = app.budget.hit
            break scenes
          }
          cfg.log(`probe ${probe.id} (${probe.kind}, ${scene.title}) sample ${i + 1}/${cfg.samples}`)
          let written: Written
          try {
            written = await writeSample(app, cfg, probe, sceneId, soFar, i)
          } catch (e) {
            written = { status: 'error', error: e instanceof Error ? e.message : String(e), generationId: null, text: '', words: 0 }
          }
          if (written.status !== 'complete' || !written.text.trim()) {
            cfg.log(`  not written: ${written.error ?? written.status}`)
            result.samples.push({ ...written, status: written.status === 'complete' ? 'error' : written.status, error: written.error ?? 'Nothing was written.', index: i, judge: { status: 'skipped', raw: '' }, results: [] })
            continue
          }
          const j = await app.askJudge(probe, written.text)
          const results = scorePassage(probe, written.text, j.answers)
          const sample: SampleResult = { ...written, index: i, judge: { status: j.status, raw: j.raw }, results }
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
      storySource: data.source,
      traps: data.traps.map(({ id, name }) => ({ id, name })),
      ...(stopped ? { stopped } : {}),
      budget: { maxIn: cfg.maxIn, maxOut: cfg.maxOut, usedIn: used.in, usedOut: used.out },
      startedAt,
      finishedAt: new Date().toISOString(),
      fake: cfg.fake,
      tested: checkout(cfg.root),
      harness: { root: cfg.harnessRoot, commit: git(cfg.harnessRoot, ['rev-parse', 'HEAD']) || 'unknown' },
      provider: app.providerName,
      prices: cfg.prices,
      models: app.models,
      samples: cfg.samples,
      words: cfg.words,
      probes: probeResults,
      usage: app.usage(),
      summary: summarise(probeResults, 'written', data.traps),
      ...(app.repairMod ? { repaired: summariseRepair(probeResults, data.traps) } : {})
    }

    const stamp = startedAt.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
    const outDir =
      cfg.out ??
      join(cfg.harnessRoot, 'traps-results', `${stamp}-${report.tested.branch.replace(/[^\w.-]+/g, '-')}-${report.tested.commit.slice(0, 7)}${cfg.fake ? '-fake' : ''}`)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(outDir, 'report.md'), reportMarkdown(report))
    writeFileSync(join(outDir, 'passages.md'), passagesMarkdown(report))
    if (stopped) cfg.log(`stopped before the end: ${stopped}`)
    cfg.log(`tokens used: ${used.in.toLocaleString('en-GB')} in, ${used.out.toLocaleString('en-GB')} out`)
    cfg.log(`report written to ${outDir}`)
    return { report, outDir }
  } finally {
    await app.close()
  }
}
