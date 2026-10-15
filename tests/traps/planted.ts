// The book's planted contradictions (book.ts PLANTED): each passage is put in a new scene just after the book's end, on a
// fresh copy of the world as the whole book left it, and checked by the app's own consistency checker exactly as Adam
// would ask for it ("Check this scene": every check, with the memory catching up first, so the memory keeper's own clash
// warnings count too). What it raises is scored against the one planted sentence:
//   caught       an issue whose quote overlaps the planted slip
//   false alarm  any other issue: on a passage with a slip, about something else; on a control, anything at all
//   decoy        a false alarm on the control's decoy sentence (a real change a careless checker calls a slip)
// Scoring is pure, so it is tested without a model; `checkPlanted` runs it through the app.

import { whenEnded, type App, type CallRecord, type IssueLike, type TrapsConfig } from './app'
import { CONSTORY_KINDS, type ConStoryKind, type Planted } from './book'
import type { StoryScene } from './storyData'

/** The live checks' own issues (underlines as Adam types), never an AI check's or the memory keeper's. */
const LIVE_KINDS = new Set(['phrase', 'repetition', 'spelling'])

export interface PlantedIssue {
  kind: string
  severity: string
  quote: string
  message: string
  /** What its quote is about: the planted slip, the control's decoy, or something else. */
  on: 'flaw' | 'decoy' | 'other'
}

export interface PlantedSample {
  index: number
  status: 'checked' | 'error' | 'stopped'
  error?: string
  issues: PlantedIssue[]
  /** The slip was flagged (null for a control). */
  caught: boolean | null
  falseAlarms: number
  /** The app's records for this check (the memory reading the passage, the check itself), with the check's reply. */
  records?: (CallRecord & { reply?: string })[]
}

export interface PlantedResult {
  id: string
  name: string
  kind: ConStoryKind
  trap: string
  planted: boolean
  sentence: string | null
  why: string
  samples: PlantedSample[]
}

export interface PlantedSummary {
  /** Checks of passages with a slip, and how many caught it. */
  slipChecks: number
  caught: number
  /** Checks of controls, and how many raised anything. */
  controlChecks: number
  controlsFlagged: number
  /** Every false alarm, on any passage. */
  falseAlarms: number
  /** False alarms on a control's decoy sentence. */
  decoys: number
  /** caught / slip checks. */
  recall: number | null
  /** caught / (caught + false alarms). */
  precision: number | null
  byKind: Record<ConStoryKind, { slipChecks: number; caught: number; falseAlarms: number }>
  /** Checks that couldn't run (an error, or the run stopped). */
  notRun: number
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * True when an issue's quote is about this sentence: one inside the other once punctuation is set aside, or four words
 * running in both (a checker often quotes part of a sentence, or a sentence and a half).
 */
export function quoteTouches(quote: string, sentence: string): boolean {
  const q = norm(quote)
  const s = norm(sentence)
  if (!q || !s) return false
  if (s.includes(q) || q.includes(s)) return true
  const qw = q.split(' ')
  const runs = new Set<string>()
  const sw = s.split(' ')
  for (let i = 0; i + 4 <= sw.length; i++) runs.add(sw.slice(i, i + 4).join(' '))
  for (let i = 0; i + 4 <= qw.length; i++) if (runs.has(qw.slice(i, i + 4).join(' '))) return true
  return false
}

/** One check of a passage, scored from the issues it raised there. */
export function scorePlanted(passage: Pick<Planted, 'flaw' | 'decoy'>, raised: Pick<IssueLike, 'kind' | 'severity' | 'quote' | 'message'>[]): Pick<PlantedSample, 'issues' | 'caught' | 'falseAlarms'> {
  const issues: PlantedIssue[] = raised
    .filter((i) => !LIVE_KINDS.has(i.kind))
    .map((i) => ({
      kind: i.kind,
      severity: i.severity,
      quote: i.quote,
      message: i.message,
      on: passage.flaw && quoteTouches(i.quote, passage.flaw) ? 'flaw' : passage.decoy && quoteTouches(i.quote, passage.decoy) ? 'decoy' : 'other'
    }))
  return {
    issues,
    caught: passage.flaw ? issues.some((i) => i.on === 'flaw') : null,
    falseAlarms: issues.filter((i) => i.on !== 'flaw').length
  }
}

export function summarisePlanted(results: PlantedResult[]): PlantedSummary {
  const byKind = Object.fromEntries(CONSTORY_KINDS.map((k) => [k.id, { slipChecks: 0, caught: 0, falseAlarms: 0 }])) as PlantedSummary['byKind']
  const s = { slipChecks: 0, caught: 0, controlChecks: 0, controlsFlagged: 0, falseAlarms: 0, decoys: 0, notRun: 0 }
  for (const r of results) {
    for (const m of r.samples) {
      if (m.status !== 'checked') {
        s.notRun++
        continue
      }
      s.falseAlarms += m.falseAlarms
      byKind[r.kind].falseAlarms += m.falseAlarms
      s.decoys += m.issues.filter((i) => i.on === 'decoy').length
      if (r.planted) {
        s.slipChecks++
        byKind[r.kind].slipChecks++
        if (m.caught) {
          s.caught++
          byKind[r.kind].caught++
        }
      } else {
        s.controlChecks++
        if (m.issues.length) s.controlsFlagged++
      }
    }
  }
  return {
    ...s,
    recall: s.slipChecks ? s.caught / s.slipChecks : null,
    precision: s.caught + s.falseAlarms ? s.caught / (s.caught + s.falseAlarms) : null,
    byKind
  }
}

const pct = (v: number | null): string => (v == null ? '–' : `${Math.round(v * 100)}%`)

/** The report's section on the planted contradictions. */
export function plantedMarkdown(results: PlantedResult[] | undefined, s: PlantedSummary | undefined): string[] {
  if (!results?.length || !s) return []
  const out = ['## Planted contradictions: what the checks caught', '']
  out.push(
    `Each passage was put just after the book’s end and checked with the app’s own consistency checker (every check, as Adam’s “Check this scene”). **Caught ${s.caught} of ${s.slipChecks}** planted slips (${pct(s.recall)}). **False alarms: ${s.falseAlarms}** (${s.controlsFlagged} of ${s.controlChecks} clean passages flagged, ${s.decoys} on a decoy: a real change taken for a slip). Of everything it raised, ${pct(s.precision)} was a planted slip.${s.notRun ? ` ${s.notRun} check${s.notRun === 1 ? '' : 's'} couldn’t run.` : ''}`,
    ''
  )
  out.push('| Kind of error | Slips caught | False alarms |', '|---|---:|---:|')
  for (const k of CONSTORY_KINDS) {
    const x = s.byKind[k.id]
    out.push(`| ${k.name} | ${x.caught} of ${x.slipChecks} | ${x.falseAlarms} |`)
  }
  out.push('', '| Passage | Kind | Planted | Result |', '|---|---|---|---|')
  const kindName = (k: ConStoryKind): string => CONSTORY_KINDS.find((x) => x.id === k)?.name ?? k
  for (const r of results) {
    const cells = r.samples.map((m) =>
      m.status !== 'checked' ? `not checked (${m.error ?? m.status})` : r.planted ? `${m.caught ? '**caught**' : 'missed'}${m.falseAlarms ? `, ${m.falseAlarms} false alarm${m.falseAlarms === 1 ? '' : 's'}` : ''}` : m.issues.length ? `**${m.issues.length} false alarm${m.issues.length === 1 ? '' : 's'}**${m.issues.some((i) => i.on === 'decoy') ? ' (decoy)' : ''}` : 'quiet (right)'
    )
    out.push(`| ${r.id}. ${r.name} | ${kindName(r.kind)} | ${r.planted ? 'a slip' : r.sentence ? 'no slip (a decoy)' : 'no slip'} | ${cells.join('; ')} |`)
  }
  const raised = results.flatMap((r) => r.samples.flatMap((m) => m.issues.map((i) => ({ r, m, i }))))
  if (raised.length) {
    out.push('', 'What the checks raised:', '')
    for (const { r, m, i } of raised) out.push(`- ${r.id}${r.samples.length > 1 ? ` #${m.index + 1}` : ''} (${i.on === 'flaw' ? 'the slip' : i.on === 'decoy' ? 'the decoy' : 'something else'}, ${i.kind}): ${i.message}${i.quote ? ` — “${i.quote}”` : ''}`)
  }
  out.push('')
  return out
}

/** Two runs' planted-contradiction scores side by side. */
export function plantedCompareRows(a: PlantedSummary | undefined, b: PlantedSummary | undefined): string[] {
  if (!a && !b) return []
  const cell = (s: PlantedSummary | undefined, f: (s: PlantedSummary) => string): string => (s ? f(s) : '–')
  return [
    `| Planted slips caught | ${cell(a, (s) => `${s.caught} of ${s.slipChecks} (${pct(s.recall)})`)} | ${cell(b, (s) => `${s.caught} of ${s.slipChecks} (${pct(s.recall)})`)} |`,
    `| False alarms (decoys) | ${cell(a, (s) => `${s.falseAlarms} (${s.decoys})`)} | ${cell(b, (s) => `${s.falseAlarms} (${s.decoys})`)} |`
  ]
}

/**
 * Runs every chosen planted passage through the app's consistency checker, each on a fresh copy of `world` (the world
 * as the whole book left it), so no passage's words reach another's memory.
 */
export async function checkPlanted(app: App, cfg: TrapsConfig, passages: Planted[], world: string, lastChapter: number): Promise<{ results: PlantedResult[]; stopped?: string }> {
  const results: PlantedResult[] = []
  if (!app.checksMod) {
    cfg.log('planted contradictions: this checkout has no consistency checker; skipped')
    return { results }
  }
  const { issuesHandlers } = app.checksMod
  for (const x of passages) {
    const r: PlantedResult = { id: x.id, name: x.name, kind: x.kind, trap: x.trap, planted: !!x.flaw, sentence: x.flaw ?? x.decoy ?? null, why: x.why, samples: [] }
    results.push(r)
    for (let i = 0; i < cfg.checkSamples; i++) {
      if (app.budget.hit) return { results, stopped: app.budget.hit }
      await app.reopen(world)
      const scene: Pick<StoryScene, 'key' | 'chapter' | 'title' | 'card'> = {
        key: x.id,
        chapter: lastChapter,
        title: x.card.title,
        card: { pov: 'tamsin', present: x.card.present, location: x.card.location, when: x.card.when, beats: [] }
      }
      const sceneId = app.makeScene(scene)
      app.save(x.id, sceneId, x.paragraphs)
      const fromRow = app.lastRow()
      const runId = `traps-${x.id}-${i}-${Date.now()}`
      cfg.log(`planted ${x.id} (${x.name}${x.flaw ? ', a slip' : ', no slip'}) check ${i + 1}/${cfg.checkSamples}`)
      try {
        const done = whenEnded<{ status: string; error: string | null }>(runId, 10 * 60_000)
        issuesHandlers.startCheck({ runId, target: { scope: 'scene', id: sceneId } })
        const ended = await done
        await app.quiet()
        if (ended.status !== 'complete') {
          r.samples.push({ index: i, status: ended.status === 'stopped' ? 'stopped' : 'error', error: ended.error ?? ended.status, issues: [], caught: null, falseAlarms: 0 })
          continue
        }
        const raised = await issuesHandlers.listIssues(sceneId)
        const scored = scorePlanted(x, raised.filter((o) => o.status === 'open'))
        const records = app.recordsSince(fromRow).map((c) => (c.kind === 'check' ? { ...c, reply: app.record(c.id)?.response ?? '' } : c))
        r.samples.push({ index: i, status: 'checked', ...scored, records })
        cfg.log(`  ${scored.caught === null ? '' : scored.caught ? 'caught; ' : 'missed; '}${scored.falseAlarms} false alarm${scored.falseAlarms === 1 ? '' : 's'}`)
      } catch (e) {
        r.samples.push({ index: i, status: 'error', error: e instanceof Error ? e.message : String(e), issues: [], caught: null, falseAlarms: 0 })
      }
    }
  }
  return { results }
}
