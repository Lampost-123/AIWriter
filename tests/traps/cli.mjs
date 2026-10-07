// npm run traps -- [flags]: scores the app's drafting against the trap story (see README.md beside this file).
// npm run traps:write -- [flags]: has a live model write story version 3 (--write).
//
//   --story v3|v2          the written long story (story-v3.json, the default) or the hand-written short one
//   --story-file <file>    another written story file (version 3)
//   --max-tokens-in <n> --max-tokens-out <n>   the hard token budget (default 2,000,000 in and 500,000 out, well
//                          under $1 at DeepSeek Flash's prices): no call is sent once it would be passed
//   --write                write the story (with --out <file>, default tests/traps/story-v3.json; --resume <partial>)
//   --fake                 use the fake provider and a stand-in judge (no key, no cost; checks the harness, not a score)
//   --provider <name>      deepseek (the default: DeepSeek's own API, with the app's DeepSeek preset) or openrouter
//   --root <folder>        score the app code in another checkout (say the step 2 branch's worktree); it needs its own
//                          node_modules (npm ci there). Default: this checkout.
//   --samples <n>          samples per probe (default 3)
//   --probes A,C           only these probes (default all)
//   --writer <model id>    writer model (default: the model with "flash" in its id, from the provider's model list)
//   --memory <model id>    memory model (default: the writer model)
//   --judge <model id>     judge model (default: the memory model)
//   --words <n>            length asked of Generate (default 600); --add-words (Add below, 400); --beat-scene-words (900)
//   --out <folder>         where the report goes (default traps-results/<date>-<branch>-<commit>); never written over
//   --price-in <usd> --price-out <usd>   per million tokens, for an estimated cost (DeepSeek reports tokens, not cost)
//   --base-url <url>       another address for the provider (only to check the harness against a local fake server)
//   --keep                 keep the throwaway data folder (the world, with what the AI saw for every call)
//   --compare <a> <b>      put two runs' report.json (or their folders) side by side; no model calls
//
// A real run reads the key from DEEPSEEK_API_KEY (OPENROUTER_API_KEY with --provider openrouter): from this
// process's environment, or on Windows from the user's saved environment variables (as set with setx or System
// Properties) when a terminal opened before it was set doesn't have it yet. It refuses to start without it, and never
// prints it.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const env = { ...process.env }
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`${name} needs a value.`)
    process.exit(2)
  }
  return v
}

/** A variable saved in the Windows user environment (HKCU\Environment), or undefined. Never printed. */
function userVariable(name) {
  if (process.platform !== 'win32') return undefined
  try {
    const out = execFileSync('reg', ['query', String.raw`HKCU\Environment`, '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const m = new RegExp(String.raw`^\s*${name}\s+REG_(?:EXPAND_)?SZ\s+(.*)$`, 'mi').exec(out)
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

const known = ['--write', '--resume', '--story', '--story-file', '--max-tokens-in', '--max-tokens-out', '--fake', '--keep', '--provider', '--price-in', '--price-out', '--base-url', '--root', '--samples', '--probes', '--writer', '--memory', '--judge', '--words', '--add-words', '--beat-scene-words', '--out', '--compare']
for (const a of args) {
  if (a.startsWith('--') && !known.includes(a)) {
    console.error(`Unknown flag ${a}. See tests/traps/README.md.`)
    process.exit(2)
  }
}

if (flag('--compare')) {
  const i = args.indexOf('--compare')
  const [a, b] = [args[i + 1], args[i + 2]]
  if (!a || !b) {
    console.error('--compare needs two report folders (or report.json files).')
    process.exit(2)
  }
  env.TRAPS_COMPARE = `${resolve(a)}|${resolve(b)}`
  delete env.TRAPS_RUN
} else {
  const fake = flag('--fake')
  const provider = value('--provider') ?? 'deepseek'
  if (provider !== 'deepseek' && provider !== 'openrouter') {
    console.error('--provider is deepseek or openrouter.')
    process.exit(2)
  }
  env.TRAPS_PROVIDER = provider
  const keyVar = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENROUTER_API_KEY'
  if (!fake && !env[keyVar]?.trim()) {
    const saved = userVariable(keyVar)
    if (saved) env[keyVar] = saved
  }
  if (!fake && !env[keyVar]?.trim()) {
    console.error(`A real trap run needs the API key in the ${keyVar} environment variable (it is never read from anywhere else). Or use --fake to check the harness without a model.`)
    process.exit(2)
  }
  if (!fake && env.CI) {
    console.error('A real trap run never runs in CI.')
    process.exit(2)
  }
  const root = value('--root')
  if (root) {
    const r = resolve(root)
    if (!existsSync(join(r, 'src', 'main', 'ai', 'draftFlow.ts'))) {
      console.error(`${r} doesn't look like an AI Write checkout.`)
      process.exit(2)
    }
    if (!existsSync(join(r, 'node_modules', 'better-sqlite3'))) {
      console.error(`${r} has no node_modules: run npm ci there first.`)
      process.exit(2)
    }
    env.TRAPS_ROOT = r
  }
  if (flag('--write')) {
    env.TRAPS_WRITE = '1'
    delete env.TRAPS_RUN
    if (root) {
      console.error("The story is written with this checkout's app code: leave out --root.")
      process.exit(2)
    }
  } else {
    env.TRAPS_RUN = '1'
    delete env.TRAPS_WRITE
  }
  const story = value('--story')
  if (story && story !== 'v2' && story !== 'v3') {
    console.error('--story is v3 (the written story) or v2 (the short hand-written one).')
    process.exit(2)
  }
  if (story) env.TRAPS_STORY = story
  const storyFile = value('--story-file')
  if (storyFile) env.TRAPS_STORY_FILE = resolve(storyFile)
  const resume = value('--resume')
  if (resume) env.TRAPS_RESUME = resolve(resume)
  for (const [f, name] of [
    ['--max-tokens-in', 'TRAPS_MAX_TOKENS_IN'],
    ['--max-tokens-out', 'TRAPS_MAX_TOKENS_OUT']
  ]) {
    const v = value(f)
    if (v === undefined) continue
    if (!/^\d+$/.test(v.replace(/[_,]/g, ''))) {
      console.error(`${f} is a number of tokens.`)
      process.exit(2)
    }
    env[name] = v.replace(/[_,]/g, '')
  }
  if (fake) env.TRAPS_FAKE = '1'
  else delete env.TRAPS_FAKE
  if (flag('--keep')) env.TRAPS_KEEP = '1'
  const set = (f, name) => {
    const v = value(f)
    if (v) env[name] = v
  }
  set('--samples', 'TRAPS_SAMPLES')
  set('--base-url', 'TRAPS_BASE_URL')
  set('--price-in', 'TRAPS_PRICE_IN')
  set('--price-out', 'TRAPS_PRICE_OUT')
  set('--probes', 'TRAPS_PROBES')
  set('--writer', 'TRAPS_WRITER_MODEL')
  set('--memory', 'TRAPS_MEMORY_MODEL')
  set('--judge', 'TRAPS_JUDGE_MODEL')
  set('--words', 'TRAPS_WORDS')
  set('--add-words', 'TRAPS_ADD_WORDS')
  set('--beat-scene-words', 'TRAPS_BEAT_SCENE_WORDS')
  const out = value('--out')
  if (out) env.TRAPS_OUT = resolve(out)
}

const vitest = join(here, 'node_modules', 'vitest', 'vitest.mjs')
const r = spawnSync(process.execPath, [vitest, 'run', '--config', join(here, 'tests', 'traps', 'vitest.traps.config.ts')], {
  cwd: here,
  env,
  stdio: 'inherit'
})
process.exit(r.status ?? 1)
