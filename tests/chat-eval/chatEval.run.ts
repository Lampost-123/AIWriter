// The chat eval and the matcher measurement, each as one long Vitest "test" so the app's TypeScript and its aliases run
// as in the unit tests. Only `npm run chat-eval` runs this (tests/chat-eval/cli.mjs, with vitest.chat-eval.config.ts):
// `npm test` never picks up a *.run.ts file, and this does nothing unless CHAT_EVAL_RUN or CHAT_EVAL_MATCHER is set.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFromEnv, git, openEvalApp, runScenario, type TurnResult } from './harness'
import { SCENARIOS, SUBSET } from './scenarios'
import { reportMarkdown, summarise, type RunMeta } from './score'
import { matcherMarkdown, measureMatcher } from './matcher'

const DAY = 24 * 60 * 60_000

function meta(root: string, extra: Partial<RunMeta>): RunMeta {
  let appVersion = ''
  try {
    appVersion = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? ''
  } catch {
    /* unknown */
  }
  return {
    backend: '',
    model: '',
    provider: '',
    commit: git(root, ['rev-parse', 'HEAD']) || 'unknown',
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    dirty: git(root, ['status', '--porcelain', '--untracked-files=no', '--', 'src']) !== '',
    appVersion,
    root,
    at: new Date().toISOString(),
    label: '',
    switches: {},
    note: '',
    ...extra
  }
}

/** A report folder is never written over. */
function freshOut(out: string, file: string): void {
  if (existsSync(join(out, file))) throw new Error(`${out} already has ${file}; give another --out folder (results are never written over).`)
  mkdirSync(out, { recursive: true })
}

const NOTES: Record<string, string> = {
  fake: 'Fake provider: plumbing only (it reads the scene and proposes only for "fix" / "tighten" / "push" questions). Not a score of any model.',
  bridge: 'File bridge: a Claude session stood in for the model, answering each request from its content only. Plumbing and prompt-clarity evidence, NOT a DeepSeek result. Tokens are estimated from text.',
  openrouter: 'A real model on OpenRouter.'
}

describe.runIf(process.env.CHAT_EVAL_RUN === '1')('chat eval', () => {
  it(
    'asks every scenario and scores it',
    async () => {
      const cfg = configFromEnv()
      freshOut(cfg.out, 'report.json')
      const wanted = cfg.only?.length === 1 && cfg.only[0] === 'SUBSET' ? SUBSET : cfg.only
      const list = wanted ? SCENARIOS.filter((s) => wanted.includes(s.id)) : SCENARIOS
      if (!list.length) throw new Error(`No scenarios match ${cfg.only?.join(',')}.`)
      const app = await openEvalApp(cfg)
      const turns: TurnResult[] = []
      const m = meta(cfg.root, { backend: cfg.backend, model: app.model, provider: app.providerName, label: cfg.label, switches: cfg.switches, note: NOTES[cfg.backend] })
      const save = (partial: boolean): void => {
        const s = summarise(turns, cfg.backend !== 'openrouter')
        writeFileSync(join(cfg.out, 'report.json'), JSON.stringify({ meta: m, partial, summary: s, turns }, null, 2))
        writeFileSync(join(cfg.out, 'report.md'), reportMarkdown(m, s, turns))
      }
      try {
        for (const s of list) {
          cfg.log(`${s.id} (${s.group}) …`)
          const got = await runScenario(app, s)
          turns.push(...got)
          for (const t of got) cfg.log(`  ${t.scenario}.${t.turn}: ${t.status}, ${t.proposals.length} proposal(s), ${t.requests} request(s)${t.nudged ? ', nudged' : ''}`)
          save(true)
          if (app.stopped()) {
            cfg.log('The cost cap was reached: stopping.')
            break
          }
        }
        save(false)
      } finally {
        await app.close()
      }
      cfg.log(`report: ${join(cfg.out, 'report.md')}`)
      expect(turns.length).toBeGreaterThan(0)
    },
    DAY
  )
})

describe.runIf(process.env.CHAT_EVAL_MATCHER === '1')('matcher measurement', () => {
  it(
    'runs realistic find strings through the agent and the page',
    async () => {
      const cfg = configFromEnv()
      freshOut(cfg.out, 'matcher.json')
      const app = await openEvalApp(cfg, { network: false })
      try {
        const rows = measureMatcher(app)
        const m = meta(cfg.root, {})
        writeFileSync(join(cfg.out, 'matcher.json'), JSON.stringify({ meta: m, rows }, null, 2))
        const md = matcherMarkdown(rows, m)
        writeFileSync(join(cfg.out, 'matcher.md'), md)
        console.log(md)
        expect(rows.length).toBeGreaterThan(30)
      } finally {
        await app.close()
      }
    },
    10 * 60_000
  )
})
