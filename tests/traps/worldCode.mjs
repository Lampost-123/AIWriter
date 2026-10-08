// Which saved worlds a run may start from (chain.ts, run.ts). Plain JS so a plain node script can use it without a
// build.
//
// A world is the database the memory built while reading the whole trap story. What decides its contents is the code
// that reads scenes and writes what it found, not the writer's prompts. So a world is matched on the git ids of only
// that code (WORLD_CODE), and a commit that changes the writer (ai/prompts.ts, ai/context.ts, edits/, plan/, repair/)
// doesn't force the memory to read the story again.
//
// The list, and why (checked against the imports of keeper/ and continuity/tracker.ts, 2026-10-08):
//   src/main/keeper              the memory keeper: its prompts, reading replies, applying them, summaries, undo
//   src/main/continuity          where things stand after each read (the stage, kept in world.db's meta)
//   src/main/memory              the memory's model of the world (the keeper reads it back while it works)
//   src/main/db                  the schema (migrations.ts) and every write the keeper makes (repo, keeper, memory, history)
//   src/main/retrieval/said.ts   what was said word for word (the keeper records it)
//   src/main/builder/fill.ts     the keeper fills found entries through it
//   src/main/storyFlows/lines.ts, src/main/worldBuilder/lines.ts   lines the keeper's undo knows
//   src/shared/continuity.ts, src/shared/stageItems.ts, src/shared/fields.ts   the stage's and the codex's shapes
// Not watched (on purpose): src/main/ai/** (the writer; also client.ts, which sends every call, and context.ts, whose
// reply-limit constants the keeper's model.ts reads), src/main/retrieval/** apart from said.ts (the search index is a
// file of its own beside world.db, rebuilt when the world opens, never saved with it), src/shared/types.ts (types only).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const WORLD_CODE = [
  'src/main/keeper',
  'src/main/continuity',
  'src/main/memory',
  'src/main/db',
  'src/main/retrieval/said.ts',
  'src/main/builder/fill.ts',
  'src/main/storyFlows/lines.ts',
  'src/main/worldBuilder/lines.ts',
  'src/shared/continuity.ts',
  'src/shared/stageItems.ts',
  'src/shared/fields.ts'
]

const git = (root, args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/**
 * One id for the world-building code at a commit of the checkout at `root` (default HEAD): a hash of each listed path's
 * git id. '' when the commit isn't in that repository (a world from elsewhere can't be told).
 */
export function worldCodeId(root, rev = 'HEAD') {
  if (!rev || git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]) === '') return ''
  const lines = WORLD_CODE.map((p) => `${p}=${git(root, ['rev-parse', `${rev}:${p}`]) || 'none'}`)
  return createHash('sha1').update(lines.join('\n')).digest('hex')
}

/** Whether the world-building code has uncommitted changes in the checkout at `root`. */
export const worldCodeDirty = (root) => git(root, ['status', '--porcelain', '--untracked-files=no', '--', ...WORLD_CODE]) !== ''

/**
 * The story file's id: a SHA-1 of its words with Windows line endings made plain (CRLF to LF), so a checkout with
 * core.autocrlf gives the same id as one without (round 8's worlds say 45d2645..., the LF file's).
 */
export function storyHash(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/** Every id a saved world may give for this story file: the LF one, and the file's own bytes (worlds saved before). */
export function storyHashes(file) {
  const raw = createHash('sha1').update(readFileSync(file)).digest('hex')
  return [...new Set([storyHash(file), raw])]
}

/**
 * Whether a saved world's code fits this checkout: the same world-building code (its `worldCode`, or for a world
 * saved before that was kept, the id worked out from its commit), or the very same src tree. `why` says what differs.
 */
export function worldCodeFits(root, saved, here) {
  if (saved.dirty) return { ok: false, why: 'the world was saved from uncommitted code' }
  if (here.dirty) return { ok: false, why: 'the world-building code here has uncommitted changes' }
  if (saved.srcTree && saved.srcTree === here.srcTree) return { ok: true, why: 'same src tree' }
  const theirs = saved.worldCode || worldCodeId(root, saved.commit)
  if (!theirs) return { ok: false, why: `the world's commit ${String(saved.commit).slice(0, 7)} isn't in this repository, so its code can't be compared` }
  if (theirs === here.worldCode) return { ok: true, why: 'same world-building code' }
  const differs = WORLD_CODE.filter((p) => git(root, ['rev-parse', `${saved.commit}:${p}`]) !== git(root, ['rev-parse', `HEAD:${p}`]))
  return { ok: false, why: `the world-building code differs${differs.length ? ` (${differs.join(', ')})` : ''}` }
}
