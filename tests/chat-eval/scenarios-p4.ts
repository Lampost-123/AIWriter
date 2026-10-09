// The chat eval's Phase 4 set (lab switch EXTRATOOLS): replace all, what is true at a point, the story so far and an
// earlier version, asked as Adam would ask them in story A with "Morning Tally" open. Run with `--scenarios p4` (also in
// `all`). Each is marked `seed: 'p4'`: the harness then adds what they need to the eval world (seedP4 below): the
// scene summaries of story A up to Morning Tally, where things stand as Morning Tally ends (as Recall keeps it), and an
// earlier History version of Morning Tally with one paragraph different. Every word is invented.

import { createHash } from 'node:crypto'
import type { Scenario } from './scenarios'

export const P4: Scenario[] = [
  {
    id: 'PX1',
    group: 'p4-extra',
    seed: 'p4',
    rule: 'A word changed all through the story is one replace_all (the count and examples shown), not an edit per place.',
    scene: 'tally',
    turns: [{ ask: 'The dog is Pitch, never Patch. Change Patch to Pitch everywhere in the story.', expect: { do: 'propose', kinds: ['replaceAll'] } }]
  },
  {
    id: 'PX2',
    group: 'p4-extra',
    seed: 'p4',
    rule: 'A misspelt name fixed everywhere is one replace_all.',
    scene: 'tally',
    turns: [{ ask: 'Rename Brom to Bram all through the story, it’s a misspelling.', expect: { do: 'propose', kinds: ['replaceAll'] } }]
  },
  {
    id: 'PX3',
    group: 'p4-extra',
    seed: 'p4',
    rule: 'What a character holds and wears here is answered from scene_state, nothing proposed.',
    scene: 'tally',
    turns: [{ ask: 'What is Ilse holding and wearing at the end of this scene?', expect: { do: 'no-propose', tool: 'scene_state' } }]
  },
  {
    id: 'PX4',
    group: 'p4-extra',
    seed: 'p4',
    rule: 'A recap is answered from story_so_far (the stored summaries up to the open scene, nothing later), nothing proposed.',
    scene: 'tally',
    turns: [{ ask: 'Give me a quick recap of the story so far.', expect: { do: 'no-propose', tool: 'story_so_far' } }]
  },
  {
    id: 'PX5',
    group: 'p4-extra',
    seed: 'p4',
    rule: 'What changed since an earlier version is answered from compare_version, nothing proposed.',
    scene: 'tally',
    turns: [{ ask: 'What did I change in this scene since the earlier version History kept?', expect: { do: 'no-propose', tool: 'compare_version' } }]
  }
]

/** What seedP4 needs of the app's code (passed in, so this file stays data and the matcher's runs never load it). */
export interface P4SeedDeps {
  putSummary(sceneId: string, text: string): void
  setMeta(key: string, value: string): void
  sceneText(sceneId: string): string
  /** Keeps an earlier version in History (null when History isn't open). */
  snapshot(sceneId: string, text: string): unknown
}

/** Story A's scene summaries, up to the open scene and one after it (which story_so_far must not give unless asked). */
const SUMMARIES: Record<string, string> = {
  steps: 'Ilse watches Bram bring the ferry in low with more barrels than she has ever seen; Quill counts them and writes nothing.',
  office: 'At the Salt Office Ilse finds Hesper’s note asking her to bring the tally book, alone.',
  vigil: 'During her vigil at the Lamp House, Quill presses Ilse about the missing barrels.',
  tally: 'Ilse and Hesper find nine barrels missing from the tally; Hesper sends Ilse to find Bram before Quill does.',
  mill: 'Ilse follows Bram to the Drowned Mill.'
}

/** Where things stand as Morning Tally ends (as Recall would keep it). */
const TALLY_END = {
  time: 'morning',
  weather: '',
  light: 'bars of light through the salt-streaked window',
  things: [{ name: 'the tally book', state: 'closed, on Hesper’s desk' }],
  characters: [
    {
      name: 'Ilse Marrow',
      where: 'by the stove',
      posture: 'kneeling',
      holding: 'nothing',
      condition: 'has not slept; hands smell of lamp oil',
      mood: 'uneasy',
      lastAction: 'rubbed Pitch’s ears',
      clothes: [{ name: 'oilskin coat', state: 'still on, damp' }]
    },
    { name: 'Hesper Marrow', where: 'at her desk', posture: 'sitting', holding: 'the tally book', condition: '', mood: 'grim', lastAction: 'closed the tally book', clothes: [{ name: 'grey shawl', state: 'slipped from one shoulder' }] }
  ]
}

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)

/**
 * The Phase 4 set's additions to the eval world: summaries of story A's scenes, the state Morning Tally ends with (kept
 * for its words as they are, the scenes before it having none), and an earlier version of Morning Tally in History.
 */
export function seedP4(scenes: Map<string, string>, deps: P4SeedDeps): void {
  for (const [key, text] of Object.entries(SUMMARIES)) {
    const id = scenes.get(key)
    if (id) deps.putSummary(id, text)
  }
  const tally = scenes.get('tally')
  if (!tally) return
  const words = deps.sceneText(tally)
  deps.setMeta('continuity', JSON.stringify({ [tally]: { hash: hashOf(words), base: '', state: TALLY_END } }))
  const paras = words.split('\n\n')
  // The earlier version: before Adam put the dog in the third paragraph.
  if (paras[2]) paras[2] = 'Ilse said nothing. Outside, the gulls cried on the slipway, high and foolish, all across the harbour.'
  deps.snapshot(tally, paras.join('\n\n'))
}
