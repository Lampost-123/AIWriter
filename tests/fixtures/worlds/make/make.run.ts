// Makes the released-code fixtures (README.md one folder up). Run against the RELEASED app's code, never this
// checkout's: `REL_ROOT=<a checkout of the release> MAKER_OUT=<folder> npx vitest run -c tests/fixtures/worlds/make/vitest.make.config.mjs`.
// It makes the sample world as "Try the sample world" does, opens it once as the app does, adds a little of what the
// sample lacks (pins, an answer, an act, an issue, a suppression, a story brief, a world's writing-preference overrides,
// a deleted scene), and saves settings.json and writing-preferences.json with every value changed from its default
// (once on the Classic look, once on the New look). Writes sample-<version>.db.gz and settings-<version>.json to
// MAKER_OUT. Invented content only; no key is ever stored.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { it } from 'vitest'

const OUT = process.env.MAKER_OUT ?? ''

it('makes the released-code fixtures', async () => {
  if (!OUT || !process.env.REL_ROOT) throw new Error('Set REL_ROOT (the release checkout) and MAKER_OUT (where the files go).')
  const data = join(OUT, 'released-data')
  rmSync(data, { recursive: true, force: true })
  process.env.AIWRITE_DATA_DIR = data
  const settings = await import('@app/main/settings')
  const world = await import('@app/main/world')
  const library = await import('@app/main/setup/library')
  const repo = await import('@app/main/db/repo')
  const mem = await import('@app/main/db/memory')
  const acts = await import('@app/main/db/acts')
  const kdb = await import('@app/main/db/keeper')
  const brief = await import('@app/main/storyBuilder/brief')
  const version = (JSON.parse(readFileSync(join(process.env.REL_ROOT, 'package.json'), 'utf8')) as { version: string }).version

  // ---- The sample world, as "Try the sample world" makes it, then opened as the app opens it.
  const id = library.makeSampleWorld()
  world.openWorld(id)
  const db = world.db()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const entries = repo.listEntries(db)
  const person = entries.find((e) => e.kind === 'character')!
  const place = entries.find((e) => e.kind === 'place')!
  const scene = outline.scenes[0]
  db.transaction(() => {
    mem.setPin(db, person.id, 'scene', scene.id, 'pin')
    mem.setPin(db, place.id, 'story', story.id, 'hide')
    mem.setPin(db, person.id, 'world', null, 'pin')
    mem.setAnswer(db, 'which-last', story.id, { storyId: story.id, note: 'Invented answer' })
    acts.createAct(db, story.id, { title: 'The lamp goes out', purpose: 'Invented act purpose' })
    kdb.addSuppression(db, 'fp-invented-1', scene.id, 'the lamp')
    repo.setMeta(db, 'writing_prefs_overrides', JSON.stringify({ tense: 'Present tense', avoidWords: ['suddenly'] }))
    brief.writeBrief(db, story.id, {
      plot: 'An invented plot about a lighthouse keeper.',
      setting: 'A made-up harbour town',
      mustHappen: 'The light is lit at midwinter.',
      avoid: 'Dragons',
      length: 'novella',
      mine: [],
      answers: [],
      recipe: null,
      codex: null,
      built: null
    })
  })()
  kdb.raiseIssue(db, {
    sceneId: scene.id,
    storyId: story.id,
    kind: 'contradiction',
    severity: 'warning',
    quote: repo.getScene(db, scene.id).text.split(/\s+/).slice(0, 4).join(' ') || 'the lamp',
    message: 'Invented issue for the upgrade test.',
    key: 'invented-issue-1',
    payload: { by: 'keeper' }
  })
  // A scene in Recently deleted.
  const extra = repo.createScene(db, outline.chapters[outline.chapters.length - 1].id, { title: 'Cut scene' })
  repo.saveSceneText(db, extra.id, null, 'An invented scene that was cut, with eleven words in it all told.')
  repo.deleteScene(db, extra.id)
  const folder = world.currentWorld().folder
  world.closeWorld()
  writeFileSync(join(OUT, `sample-${version}.db.gz`), gzipSync(readFileSync(join(folder, 'world.db')), { level: 9 }))

  // ---- settings.json with every value changed from its default.
  settings.updateSettings({
    providers: [
      { id: 'prov-1', name: 'Invented provider', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', hasKey: false, lastCheck: { ok: true, at: '2026-10-01T10:00:00.000Z' } }
    ],
    models: {
      writer: { providerId: 'prov-1', modelId: 'made-up/writer', label: 'Writer', contextLength: 64000, promptPrice: 0.1, completionPrice: 0.2, maxOutput: 8000, sampling: true },
      memory: { providerId: 'prov-1', modelId: 'made-up/memory', label: 'Memory', contextLength: 32000, promptPrice: null, completionPrice: null }
    },
    thinking: { writer: 'low', chapter: 'high' },
    creativity: 'adventurous',
    planFirst: false,
    sceneContracts: false,
    continuityBrief: false,
    theme: 'sepia',
    editor: { fontSize: 21, lineHeight: 1.9, pageWidth: 60, paragraphStyle: 'indented', smartPunctuation: false, spellCheck: false, typewriter: true },
    goals: { daily: 1200, days: [{ date: '2026-10-01', words: 900 }] },
    layout: { binderWidth: 300, inspectorWidth: 360, binderOpen: false, inspectorOpen: true, deskStory: 'slim' },
    lastWorldId: id,
    lastStoryId: story.id,
    lastSceneId: scene.id,
    lastPlaces: { [id]: { storyId: story.id, sceneId: scene.id } },
    backup: { extraFolder: null },
    speech: { readAloud: true, speed: 1.2, narratorVoice: 'invented-voice', sounds: true, soundVolume: 0.3, cacheLimitGb: 2 },
    accent: '#3366aa',
    usage: { monthlyLimit: 12.5, notice: { month: '2026-10', limit: 12.5, warned: true, reached: false, carryOn: false } },
    firstRun: null,
    startWith: 'last',
    tourSeen: true,
    worldsSeenAt: { [id]: '2026-10-02T09:00:00.000Z' },
    look: 'classic',
    lookNote: false,
    arrangement: 'panels',
    arrangementNote: false,
    checkNewWords: false,
    checkWhenDone: true,
    checkAfterDraft: false,
    checkSecondOpinion: false,
    chapterCritic: true,
    findByMeaning: false,
    searchModelAuto: false
  } as never)
  const lib = settings.getSettings().libraryPath
  settings.setWritingPrefs({
    spelling: 'US',
    pov: 'First person',
    tense: 'Present tense',
    voiceNotes: 'Invented voice notes.',
    avoidWords: ['very', 'suddenly'],
    avoidAiPhrases: false,
    sceneLength: 2200,
    chapterLength: 6000
  } as never)
  // What the released code saved, and what it reads back: the new code must read the same.
  const rawOf = (): unknown => JSON.parse(readFileSync(join(data, 'app', 'settings.json'), 'utf8'))
  const classic = { raw: rawOf(), read: settings.getSettings() }
  settings.updateSettings({ look: 'new', arrangement: 'desk' } as never)
  const newLook = { raw: rawOf(), read: settings.getSettings() }
  const prefs = { raw: JSON.parse(readFileSync(join(lib, 'writing-preferences.json'), 'utf8')), read: settings.getWritingPrefs() }
  const made = `AI Write ${version}: settings.json and writing-preferences.json as that code saved them, and what it read back`
  // The library folder is machine-specific: the test puts its own in place of <LIBRARY>.
  const text = JSON.stringify({ made, classic, newLook, prefs }, null, 2).split(JSON.stringify(lib).slice(1, -1)).join('<LIBRARY>')
  writeFileSync(join(OUT, `settings-${version}.json`), `${text}\n`)
})
