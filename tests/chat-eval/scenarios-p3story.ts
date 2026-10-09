// The chat eval's story-tools set (chat Phase 3, lab switch STORYTOOLS): consistency issues, chapter cards and plot
// threads, asked as Adam would ask them in story A with "Morning Tally" open. Run with `--scenarios p3story` (`p3`
// runs it with the text-tools set; also in `all`). Each is marked `seed: 'story'`: the harness then adds what they need to the eval world (seedStory below):
// two plot threads opened earlier on the line, one planned on a later scene's card, and an open continuity issue in
// the open scene. Every word is invented.

import type Database from 'better-sqlite3'
import type { Scenario } from './scenarios'

const propose = (kinds: ('issueFix' | 'chapterCard' | 'thread')[]): { do: 'propose'; kinds: ('issueFix' | 'chapterCard' | 'thread')[] } => ({ do: 'propose', kinds })

export const P3STORY: Scenario[] = [
  {
    id: 'ST1',
    group: 'p3-story',
    seed: 'story',
    rule: 'An open consistency issue is fixed through issue_fix (it is marked fixed), not as a plain edit.',
    scene: 'tally',
    turns: [{ ask: 'Fix the open continuity issue in this scene.', expect: propose(['issueFix']) }]
  },
  {
    id: 'ST2',
    group: 'p3-story',
    seed: 'story',
    rule: 'A question about the story’s open issues is answered from list_issues, nothing proposed.',
    scene: 'tally',
    turns: [{ ask: 'Are there any open consistency issues anywhere in this story?', expect: { do: 'no-propose', tool: 'list_issues' } }]
  },
  {
    id: 'ST3',
    group: 'p3-story',
    seed: 'story',
    rule: 'A chapter card’s point of view is set by name through chapter_card.',
    scene: 'tally',
    turns: [{ ask: "Set chapter 2's POV to Ilse.", expect: propose(['chapterCard']) }]
  },
  {
    id: 'ST4',
    group: 'p3-story',
    seed: 'story',
    rule: 'Which plot threads are open is answered from list_threads as of the open scene (the later one labelled), nothing proposed.',
    scene: 'tally',
    turns: [{ ask: 'Which threads are still open?', expect: { do: 'no-propose', tool: 'list_threads' } }]
  },
  {
    id: 'ST5',
    group: 'p3-story',
    seed: 'story',
    rule: 'A plot thread is paid off in the open scene through a thread change (resolve).',
    scene: 'tally',
    turns: [{ ask: 'Mark the lamp-oil thread as paid off here.', expect: propose(['thread']) }]
  },
  {
    id: 'ST6',
    group: 'p3-story',
    seed: 'story',
    rule: 'A new plot thread is started in the open scene (a thread change with a name no thread has, and its promise).',
    scene: 'tally',
    turns: [{ ask: 'Start a new plot thread here: who tore the page out of the tally book?', expect: propose(['thread']) }]
  }
]

/** What seedStory needs of the app's code (passed in, so this file stays data and the matcher's runs never load it). */
export interface StorySeedDeps {
  createEntry(db: Database.Database, kind: 'thread', input: { name: string; fields?: Record<string, string> }): { id: string }
  insertChange(db: Database.Database, c: { kind: 'thread'; payload: { status: 'open' | 'resolved'; note: string }; entryId: string; anchor: 'scene'; sceneId: string; origin: 'adam' }): unknown
  getCard(db: Database.Database, sceneId: string): Record<string, unknown> & { setsUpIds: string[] }
  updateCard(db: Database.Database, sceneId: string, card: Record<string, unknown>): unknown
}

/**
 * The story set's additions to the eval world: plot threads "The lamp oil" (opened in the vigil) and "The nine barrels"
 * (opened at the ferry steps), "The second ledger" set up on the Drowned Mill's card only (later; its name and promise
 * are no canary, so only the later scene's label may leak), and an open continuity issue in Morning Tally with the
 * check's suggested rewrite.
 */
export function seedStory(db: Database.Database, storyId: string, scenes: Map<string, string>, deps: StorySeedDeps): void {
  const lamp = deps.createEntry(db, 'thread', { name: 'The lamp oil', fields: { promise: 'Whose lamp oil is on Ilse’s hands, and why does it matter?' } })
  const barrels = deps.createEntry(db, 'thread', { name: 'The nine barrels', fields: { promise: 'Where did the nine barrels go?' } })
  const key = deps.createEntry(db, 'thread', { name: 'The second ledger', fields: { promise: 'Does Quill keep a second ledger?' } })
  deps.insertChange(db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: lamp.id, anchor: 'scene', sceneId: scenes.get('vigil')!, origin: 'adam' })
  deps.insertChange(db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: barrels.id, anchor: 'scene', sceneId: scenes.get('steps')!, origin: 'adam' })
  const mill = scenes.get('mill')!
  const card = deps.getCard(db, mill)
  deps.updateCard(db, mill, { ...card, setsUpIds: [...(card.setsUpIds ?? []), key.id] })
  const t = new Date().toISOString()
  db.prepare(
    'INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'eval-issue-pitch',
    scenes.get('tally')!,
    storyId,
    'continuity',
    'warning',
    'open',
    'Pitch came in wet and shook himself by the stove.',
    'Pitch was left shut in at the Lamp House at the end of the vigil, so he can’t come in wet from outside here.',
    JSON.stringify({ key: 'eval:pitch', fix: 'Pitch, let out of the Lamp House at last, came in wet and shook himself by the stove.' }),
    t,
    t
  )
}
