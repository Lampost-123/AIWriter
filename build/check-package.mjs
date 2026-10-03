// Checks a packaged app holds only what it should: the built app (out/), package.json,
// resources/ and the runtime node_modules, at about the size that comes to. A mistake in the
// `files` lists of electron-builder.yml once put the whole project folder in the installer.
//
//   node build/check-package.mjs release/win-unpacked/resources/app.asar --native win32-x64
//
// --native names the database engine build that must sit unpacked next to the archive.
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) ?? 'release/win-unpacked/resources/app.asar'
const native = args.includes('--native') ? args[args.indexOf('--native') + 1] : null
const ALLOWED = new Set(['out', 'package.json', 'resources', 'node_modules'])
const MAX_MB = 50

const problems = []
const listed = asar.listPackage(file).map((p) => p.replace(/\\/g, '/'))
const top = [...new Set(listed.map((p) => p.split('/')[1]).filter(Boolean))]
const extra = top.filter((t) => !ALLOWED.has(t))
const mb = statSync(file).size / 1e6
console.log(`${file}: ${mb.toFixed(1)} MB, holding ${top.join(', ')}`)

if (extra.length) problems.push(`the app holds files that aren't part of it (${extra.join(', ')}); check the platform "files" lists in electron-builder.yml`)
if (mb > MAX_MB) problems.push(`app.asar is ${mb.toFixed(0)} MB, far more than the app needs (about 28 MB)`)
// The thesaurus for synonyms (writing by hand, under 1 MB) ships in resources/, with the WordNet licence it needs.
for (const needed of ['resources/thesaurus/en-thesaurus.txt.gz', 'resources/thesaurus/WordNet-LICENSE.txt']) {
  if (!listed.includes(`/${needed}`)) problems.push(`${needed} is missing from the app (synonyms need it); check resources/** in electron-builder.yml`)
}
if (native) {
  const node = join(`${file}.unpacked`, 'node_modules', 'better-sqlite3', 'prebuilds', `${native}.node`)
  if (!existsSync(node)) problems.push(`the database engine for ${native} is missing (${node})`)
}

for (const p of problems) console.error(`::error::${p}`)
process.exit(problems.length ? 1 : 0)
