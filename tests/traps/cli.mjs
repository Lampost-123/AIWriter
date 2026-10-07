// npm run traps -- [flags]: scores the app's drafting against the trap story (see README.md beside this file).
//
//   --fake                 use the fake provider and a stand-in judge (no key, no cost; checks the harness, not a score)
//   --root <folder>        score the app code in another checkout (say the step 2 branch's worktree); it needs its own
//                          node_modules (npm ci there). Default: this checkout.
//   --samples <n>          samples per probe (default 3)
//   --probes A,C           only these probes (default all)
//   --writer <model id>    writer model (default: DeepSeek Flash from OpenRouter's list)
//   --memory <model id>    memory model (default: the writer model)
//   --judge <model id>     judge model (default: the memory model)
//   --words <n>            length asked of Generate (default 600); --add-words (Add below, 400); --beat-scene-words (900)
//   --out <folder>         where the report goes (default traps-results/<date>-<branch>-<commit>)
//   --keep                 keep the throwaway data folder (the world, with what the AI saw for every call)
//   --compare <a> <b>      put two runs' report.json (or their folders) side by side; no model calls
//
// A real run reads the OpenRouter API key from OPENROUTER_API_KEY only, and refuses to start without it.
import { spawnSync } from 'node:child_process'
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

const known = ['--fake', '--keep', '--root', '--samples', '--probes', '--writer', '--memory', '--judge', '--words', '--add-words', '--beat-scene-words', '--out', '--compare']
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
  if (!fake && !env.OPENROUTER_API_KEY?.trim()) {
    console.error('A real trap run needs your OpenRouter API key in the OPENROUTER_API_KEY environment variable (it is never read from anywhere else). Or use --fake to check the harness without a model.')
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
  env.TRAPS_RUN = '1'
  if (fake) env.TRAPS_FAKE = '1'
  else delete env.TRAPS_FAKE
  if (flag('--keep')) env.TRAPS_KEEP = '1'
  const set = (f, name) => {
    const v = value(f)
    if (v) env[name] = v
  }
  set('--samples', 'TRAPS_SAMPLES')
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
