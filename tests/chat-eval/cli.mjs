// npm run chat-eval -- [flags]: the editor chat ("Ask the world") eval. See the comments at the top of harness.ts,
// scenarios.ts, score.ts and matcher.ts beside this file.
//
//   --backend fake|bridge|openrouter   the model behind the chat (default fake):
//        fake        the fake provider: plumbing only, no network, no cost
//        bridge      the file bridge: each request is written to <bridge-dir>\pending\<seq>-ask.json (messages, tools,
//                    tool_choice) and the run waits for <bridge-dir>\done\<seq>-ask.json {"content", "tool_calls"}
//        openrouter  a real model; refuses unless AIWRITE_CHAT_EVAL_PAID=yes AND a cap (--max-usd or
//                    AIWRITE_CHAT_EVAL_MAX_USD) are set, and OPENROUTER_API_KEY is in the environment; never in CI
//        deepseek    a real model on DeepSeek's own API (default deepseek-flash); the same locks, with DEEPSEEK_API_KEY
//   --scenarios E01,S03|subset     only these (default all 40; "subset" is the 12 in scenarios.ts SUBSET)
//   --out <folder>                 report folder (default ..\AIWriter-chat-results\<date>-<backend>); never written over
//   --bridge-dir <folder>          the bridge's folder (default ..\AIWriter-chat-results\bridge)
//   --model <id>                   OpenRouter model (default: DeepSeek Flash from OpenRouter's list)
//   --max-usd <n>                  the paid run's hard cap: no request is sent once it could pass it
//   --root <folder>                run another checkout's app code (it needs its own node_modules: npm ci there)
//   --env NAME=VALUE               set a switch for the app's code (repeatable), e.g. --env AIWRITE_EXP_CHAT_X=on;
//                                  every AIWRITE_EXP_* already in the environment passes through too, and all are
//                                  recorded in the report
//   --label <text>                 a name for the run (in the report and the bridge's file names)
//   --matcher                      the free matcher measurement instead of the scenarios (no model, no network)
//   --keep                         keep the throwaway data folder
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const env = { ...process.env }
const known = ['--backend', '--scenarios', '--out', '--bridge-dir', '--model', '--max-usd', '--root', '--env', '--label', '--matcher', '--keep']
const fail = (msg) => {
  console.error(msg)
  process.exit(2)
}
for (const a of args) if (a.startsWith('--') && !known.includes(a)) fail(`Unknown flag ${a}. See the top of tests/chat-eval/cli.mjs.`)
const values = (name) => {
  const out = []
  args.forEach((a, i) => {
    if (a !== name) return
    const v = args[i + 1]
    if (!v || v.startsWith('--')) fail(`${name} needs a value.`)
    out.push(v)
  })
  return out
}
const value = (name) => values(name).at(-1)

/** A variable saved in the Windows user environment, or undefined. Never printed. */
function userVariable(name) {
  if (process.platform !== 'win32') return undefined
  try {
    const out = execFileSync('reg', ['query', String.raw`HKCU\Environment`, '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return new RegExp(String.raw`^\s*${name}\s+REG_(?:EXPAND_)?SZ\s+(.*)$`, 'mi').exec(out)?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

for (const k of ['CHAT_EVAL_RUN', 'CHAT_EVAL_MATCHER', 'TRAPS_RUN', 'TRAPS_WRITE', 'TRAPS_RESCORE', 'TRAPS_COMPARE']) delete env[k]
if (args.includes('--matcher')) env.CHAT_EVAL_MATCHER = '1'
else env.CHAT_EVAL_RUN = '1'

const backend = value('--backend') ?? 'fake'
if (!['fake', 'bridge', 'openrouter', 'deepseek'].includes(backend)) fail('--backend is fake, bridge, openrouter or deepseek.')
env.CHAT_EVAL_BACKEND = args.includes('--matcher') ? 'fake' : backend

const maxUsd = value('--max-usd')
if (maxUsd !== undefined) {
  if (!(Number(maxUsd) > 0)) fail('--max-usd is a number of dollars above 0.')
  env.AIWRITE_CHAT_EVAL_MAX_USD = maxUsd
}
if (env.CHAT_EVAL_BACKEND === 'openrouter' || env.CHAT_EVAL_BACKEND === 'deepseek') {
  // Both locks, checked here before anything starts (and again in the harness before any network call).
  const keyName = env.CHAT_EVAL_BACKEND === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENROUTER_API_KEY'
  if (env.AIWRITE_CHAT_EVAL_PAID !== 'yes') fail('A real-model run costs money: set AIWRITE_CHAT_EVAL_PAID=yes to allow it.')
  if (!(Number(env.AIWRITE_CHAT_EVAL_MAX_USD) > 0)) fail('A real-model run needs a cost cap: --max-usd <dollars> (or AIWRITE_CHAT_EVAL_MAX_USD).')
  if (!env[keyName]?.trim()) {
    const saved = userVariable(keyName)
    if (saved) env[keyName] = saved
  }
  if (!env[keyName]?.trim()) fail(`A real-model run needs ${keyName} in the environment.`)
  if (env.CI) fail('A real-model run never runs in CI.')
}

const scen = value('--scenarios')
if (scen) env.CHAT_EVAL_SCENARIOS = scen.toLowerCase() === 'subset' ? 'SUBSET' : scen
const out = value('--out')
if (out) env.CHAT_EVAL_OUT = resolve(out)
const bridgeDir = value('--bridge-dir')
if (bridgeDir) env.CHAT_EVAL_BRIDGE_DIR = resolve(bridgeDir)
const model = value('--model')
if (model) env.CHAT_EVAL_MODEL = model
const label = value('--label')
if (label) env.CHAT_EVAL_LABEL = label
if (args.includes('--keep')) env.CHAT_EVAL_KEEP = '1'
for (const kv of values('--env')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(kv)
  if (!m) fail(`--env takes NAME=VALUE, not ${kv}.`)
  env[m[1]] = m[2]
}
const root = value('--root')
if (root) {
  const r = resolve(root)
  if (!existsSync(join(r, 'src', 'main', 'ipc', 'ask.ts'))) fail(`${r} doesn't look like an AI Write checkout.`)
  if (!existsSync(join(r, 'node_modules', 'better-sqlite3'))) fail(`${r} has no node_modules: run npm ci there first.`)
  env.TRAPS_ROOT = r
}

const vitest = join(here, 'node_modules', 'vitest', 'vitest.mjs')
const r = spawnSync(process.execPath, [vitest, 'run', '--config', join(here, 'tests', 'chat-eval', 'vitest.chat-eval.config.ts')], { cwd: here, env, stdio: 'inherit' })
process.exit(r.status ?? 1)
