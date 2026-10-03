// The sample world's content (milestone 6): a small, original world written for AI Write, never anyone's
// real story. Plain data, read by sampleWorld.ts, which makes the world through the usual SQL helpers.
//
// Gullhaven: a fishing town under a lighthouse. Wren Halloway keeps the light now that her father's hands
// shake; a stranger off the night ferry brings a sealed letter saying the light is to be put out at midwinter.
// One story ("The Keeper's Light"), two chapters, four short scenes, with the memory already read from them:
// who exists where, what changes (with the words each change came from), who knows what, two plot threads,
// relationships, and summaries at every level.
//
// Keys ('wren', 's2') stand for ids until the world is made. A quote must be words of its scene, exactly.

import type { EntryKind } from '@shared/types'

export const SAMPLE_NAME = 'Sample world: Gullhaven'

export const SAMPLE_WORLD = {
  themes:
    'What a town owes the people who keep it safe. Old duties against new sums. Whether pride and need can live in the same house.',
  tone: 'Quiet and salt-worn, warm underneath, with a thread of unease.',
  style: {
    pov: 'Close third person',
    tense: 'Past tense',
    spelling: 'UK' as const,
    proseStyle: 'Plain, concrete prose. Let the weather and small tasks carry the feeling; keep dialogue short.'
  }
}

export const SAMPLE_STORY = {
  title: 'The Keeper’s Light',
  premise:
    'When a stranger brings word that the Gullhaven Light is to be put out for good, the keeper’s daughter has one winter to prove the town still needs it.'
}

export interface SampleEntry {
  key: string
  kind: EntryKind
  name: string
  aliases?: string[]
  summary: string
  description?: string
  fields?: Record<string, string>
  hardRule?: boolean
  /** Its parent place, by key. */
  parent?: string
  /**
   * Who made it: Adam (typed it himself) or the memory reading a scene (`scene`, by key), with the words it was
   * found in and the words each field came from (in the same scene, unless it says another).
   */
  made: { by: 'adam' } | { by: 'text'; scene: string; quote: string; fieldQuotes?: Record<string, string | { scene: string; quote: string }> }
}

export const SAMPLE_ENTRIES: SampleEntry[] = [
  {
    key: 'wren',
    kind: 'character',
    name: 'Wren Halloway',
    aliases: ['Wren'],
    summary: 'The keeper’s daughter, who lights the Gullhaven Light now that her father’s hands shake.',
    description:
      'Nineteen, small and stubborn, raised in the lamp room. She has kept the light in all but name since her father’s hands began to fail, and would rather climb the hundred and twelve steps twice than admit she is tired.',
    fields: {
      pronouns: 'she/her',
      age: '19',
      role: 'protagonist',
      build: 'Small and wiry, strong in the shoulders from the lamp-room stairs',
      hair: 'Dark, cut short with the kitchen shears',
      eyes: 'Grey',
      marks: 'A shiny burn scar on the back of her right hand, from the lamp',
      clothing: 'Her father’s oilskin coat, sleeves rolled twice',
      traits: 'Stubborn, practical, quick to read the weather',
      values: 'Keeping her word. Keeping the light.',
      flaws: 'Won’t ask for help. Mistakes being needed for being loved.',
      fears: 'A night the light goes dark and a boat is lost because of her.',
      wants: 'To be named keeper by the Harbour Board, in her own right.',
      needs: 'To let other people carry some of the weight.',
      motivation: 'Keep the light lit and her father’s pride whole.',
      speech: 'Short, plain sentences. Talks about the weather when she means something else.',
      tics: 'Says “Right, then” before doing something hard.',
      neverSays: 'That she is tired.',
      sampleLines: 'Right, then. Wick first, glass after.\nThe wind’s backing west. You’ll want to be in before dark.\nHe’s fine. He’s resting his hands.'
    },
    made: { by: 'adam' }
  },
  {
    key: 'edric',
    kind: 'character',
    name: 'Edric Halloway',
    aliases: ['Edric'],
    summary: 'Keeper of the Gullhaven Light for forty years, and Wren’s father.',
    description:
      'Sixty-one, broad, slow on the stairs now. He talks to the lamp as if she were a moody boat and has never once let her go dark. His hands have begun to shake, and he hides it badly.',
    fields: {
      pronouns: 'he/him',
      age: '61',
      role: 'supporting',
      build: 'Broad and heavy-shouldered, gone soft at the middle',
      hair: 'White, thick, never combed',
      clothing: 'A darned fisherman’s jersey and a coat with deep pockets',
      traits: 'Patient, proud, dry',
      flaws: 'Too proud to be helped, even by his daughter.',
      fears: 'Being thanked and sent away.',
      wants: 'For the light to outlast him.',
      speech: 'Slow and careful, salted with old sea sayings. Calls the lamp “she”.',
      sampleLines: 'She’s sulking tonight. Give her a clean wick and a kind word.\nWell. They’ve done their sums.'
    },
    made: { by: 'adam' }
  },
  {
    key: 'ansel',
    kind: 'character',
    name: 'Ansel Crane',
    aliases: ['Ansel'],
    summary: 'Gullhaven’s harbourmaster, the Board’s man in town, and Wren’s godfather.',
    description: 'Fifty-four, thin, always slightly out of breath. Official in public; gentle with Wren when no one is watching.',
    fields: {
      pronouns: 'he/him',
      age: '54',
      role: 'supporting',
      build: 'Thin and stooped',
      clothing: 'A harbourmaster’s coat, usually buttoned wrong',
      traits: 'Careful, kind, anxious',
      speech: 'Brisk and full of forms and dates until he is alone with you; then quiet.',
      sampleLines: 'One passenger. One. In this weather.\nI told her the keeper was abed.'
    },
    made: { by: 'adam' }
  },
  {
    key: 'iska',
    kind: 'character',
    name: 'Iska Vey',
    aliases: ['Iska'],
    summary: 'A clerk of the Harbour Board in Cray, sent on the night ferry with a sealed letter for the keeper.',
    fields: {
      pronouns: 'she/her',
      clothing: 'A grey travelling coat, salt-stained at the hem'
    },
    made: {
      by: 'text',
      scene: 's2',
      quote: 'Iska Vey',
      fieldQuotes: { pronouns: 'she said', clothing: 'a grey travelling coat salt-stained at the hem' }
    }
  },
  {
    key: 'gullhaven',
    kind: 'place',
    name: 'Gullhaven',
    summary: 'A fishing town of steep lanes and slate roofs above a narrow harbour.',
    fields: {
      atmosphere: 'Close-knit and weathered. Everyone knows whose boat is late.',
      senses: 'Tar, wet rope and gutted fish; gulls; the long sweep of the light across the roofs at night.',
      people: 'The Harbour Board in Cray rules it on paper. The harbourmaster rules it in fact.'
    },
    made: { by: 'adam' }
  },
  {
    key: 'light',
    kind: 'place',
    name: 'The Gullhaven Light',
    aliases: ['the light'],
    summary: 'The lighthouse on the headland above Gullhaven: a hundred and twelve steps to the lamp room.',
    fields: {
      atmosphere: 'Warm in the lamp room, cold everywhere else.',
      senses: 'Lamp oil, hot brass, the hiss of the flame and the wind at the glass.',
      history: 'Lit every night for a hundred and forty years.'
    },
    parent: 'gullhaven',
    made: { by: 'adam' }
  },
  {
    key: 'steps',
    kind: 'place',
    name: 'The Drowned Steps',
    summary: 'A causeway of old stone steps out to Bell Rock, above water only at low tide.',
    fields: {
      geography: 'A causeway of old cut stone, green with weed, from the foot of the headland out to Bell Rock.'
    },
    made: {
      by: 'text',
      scene: 's3',
      quote: 'the Drowned Steps',
      fieldQuotes: {
        geography: { scene: 's4', quote: 'a causeway of old cut stone, green with weed, running from the foot of the headland out to Bell Rock' }
      }
    }
  },
  {
    key: 'board',
    kind: 'group',
    name: 'The Harbour Board',
    aliases: ['the Board'],
    summary: 'The board in Cray that holds the Harbour Charter and pays Gullhaven’s keeper.',
    fields: {
      category: 'Governing board',
      goals: 'Keep the coast’s harbours open as cheaply as it can.'
    },
    made: { by: 'adam' }
  },
  {
    key: 'rule',
    kind: 'lore',
    name: 'The light is never dark',
    summary: 'By the Harbour Charter, the Gullhaven Light burns every night from dusk to dawn.',
    fields: {
      category: 'Law and custom',
      rules: 'The lamp is lit at dusk and burns until dawn, every night, whatever the weather.',
      limits: 'A keeper who lets the light go dark loses the post.'
    },
    hardRule: true,
    made: { by: 'adam' }
  },
  {
    key: 'letter',
    kind: 'thread',
    name: 'What is in the sealed letter?',
    summary: 'The Harbour Board’s letter, sent by night for the keeper’s hands only.',
    fields: { promise: 'What news is bad enough to send by night ferry, a day early, in a westerly?' },
    made: { by: 'text', scene: 's2', quote: 'I have a letter for Edric Halloway' }
  },
  {
    key: 'midwinter',
    kind: 'thread',
    name: 'Will the light go dark at midwinter?',
    summary: 'The Board means to replace the light with a bell buoy at midwinter.',
    fields: {
      promise: 'Can Wren save the Gullhaven Light before midwinter?',
      payoff: 'Wren proves the light is needed, though not in the way she expected.'
    },
    made: { by: 'adam' }
  }
]

/** Relationships Adam set on the entry pages (before the story). */
export const SAMPLE_RELATIONSHIPS = [
  {
    entry: 'wren',
    otherId: 'edric',
    type: 'daughter',
    feels: 'Fiercely protective; impatient with his pride',
    otherFeels: 'Proud of her, and ashamed to need her'
  },
  {
    entry: 'ansel',
    otherId: 'wren',
    type: 'godfather',
    feels: 'Fond and worried; thinks she carries too much',
    otherFeels: 'Trusts him, though he is the Board’s man'
  },
  { entry: 'ansel', otherId: 'board', type: 'member (harbourmaster)', feels: 'Loyal, uneasily', otherFeels: '' }
]

export const LETTER_FACT = 'The Harbour Board means to put out the Gullhaven Light at midwinter.'

/** What the memory read from each scene, each with the words it came from. */
export type SampleChange =
  | { entry: string; scene: string; quote: string; kind: 'update'; note: string; fields?: Record<string, string> }
  | { entry: string; scene: string; quote: string; kind: 'knowledge'; fact: 'letter' }
  | { entry: string; scene: string; quote: string; kind: 'thread'; status: 'open' | 'resolved'; note: string }
  | { entry: string; scene: string; quote: string; kind: 'relationship'; otherId: string; type: string; feels: string; otherFeels: string }

export const SAMPLE_CHANGES: SampleChange[] = [
  {
    entry: 'edric',
    scene: 's1',
    kind: 'update',
    note: 'His hands shake too much to tend the lamp; Wren lights it now',
    fields: { movement: 'Slow on the stairs; keeps his shaking hands in his pockets' },
    quote: 'kept his hands in his coat pockets so she wouldn’t see them shake'
  },
  { entry: 'letter', scene: 's2', kind: 'thread', status: 'open', note: 'Iska Vey brings a sealed letter for the keeper', quote: 'I have a letter for Edric Halloway' },
  { entry: 'iska', scene: 's2', kind: 'knowledge', fact: 'letter', quote: 'I know what it says' },
  { entry: 'edric', scene: 's3', kind: 'knowledge', fact: 'letter', quote: 'The Harbour Board means to put out the Gullhaven Light at midwinter' },
  { entry: 'wren', scene: 's3', kind: 'knowledge', fact: 'letter', quote: 'The Harbour Board means to put out the Gullhaven Light at midwinter' },
  { entry: 'letter', scene: 's3', kind: 'thread', status: 'resolved', note: 'The light is to be put out at midwinter', quote: 'Her father read the letter at the kitchen table' },
  { entry: 'midwinter', scene: 's3', kind: 'thread', status: 'open', note: 'Seven weeks until midwinter', quote: 'That’s seven weeks.' },
  {
    entry: 'wren',
    scene: 's4',
    kind: 'update',
    note: 'Tore the skin off her left palm on the old bell rope',
    fields: { marks: 'A shiny burn scar on the back of her right hand; a fresh rope burn across her left palm' },
    quote: 'it took the skin off her left palm as it came'
  },
  {
    entry: 'wren',
    scene: 's4',
    kind: 'relationship',
    otherId: 'iska',
    type: 'uneasy allies',
    feels: 'Doesn’t trust her yet, but needs her',
    otherFeels: 'Admires her nerve',
    quote: 'Iska took Wren’s good hand to steady herself on the weed, and Wren let her'
  }
]

export interface SampleScene {
  key: string
  title: string
  status: 'done' | 'drafted'
  card: {
    pov: string
    present: string[]
    location: string
    when: string
    goal: string
    conflict: string
    outcome: string
    mood: string
    setsUp?: string[]
    paysOff?: string[]
  }
  paragraphs: string[]
  summary: string
}

export interface SampleChapter {
  title: string
  goal: string
  summary: string
  scenes: SampleScene[]
}

export const SAMPLE_CHAPTERS: SampleChapter[] = [
  {
    title: 'The Night Ferry',
    goal: 'Show the light, the family that keeps it, and the stranger who comes for it.',
    summary:
      'Wren lights the Gullhaven Light alone for the first time as her father watches, hiding his shaking hands, and they see the night ferry from Cray coming in a day early. At the harbour, a Board clerk, Iska Vey, arrives with a sealed letter she will put only into Edric’s hands, and admits she already knows it is bad news.',
    scenes: [
      {
        key: 's1',
        title: 'Lighting the Lamp',
        status: 'done',
        card: {
          pov: 'wren',
          present: ['wren', 'edric'],
          location: 'light',
          when: 'Day 1, dusk',
          goal: 'Wren lights the lamp; show that she keeps the light now in all but name.',
          conflict: 'Her father’s pride against his failing hands.',
          outcome: 'The light is lit, and the night ferry is seen coming in early.',
          mood: 'Hushed, windy, tender'
        },
        paragraphs: [
          'The wind came round to the west an hour before dusk, and Wren Halloway felt it in the stairs before she heard it at the windows. A hundred and twelve steps to the lamp room. She had counted them every night since she was six, first on her father’s back and then on her own feet, and she counted them now with the oil can knocking against her knee.',
          'Her father was already at the top, which meant he had started up long before her and stopped to rest more than once. Edric Halloway stood by the great glass with his back to her and kept his hands in his coat pockets so she wouldn’t see them shake.',
          '“She’s sulking tonight,” he said, meaning the lamp. “Give her a clean wick and a kind word.”',
          '“Right, then.” Wren set down the can and trimmed the wick herself, the way he had taught her: square across, no ragged threads to smoke the glass. Her right hand still carried the shiny burn from the winter she was twelve, when she had been in too much of a hurry. She was not in a hurry now.',
          'The flame caught, steadied, and climbed. Behind it the lens turned the small fire into a long white arm that swept out over Gullhaven’s slate roofs, the harbour, the black water beyond. The light is never dark. It was written in the Harbour Charter, framed on the cottage wall, and older than either of them.',
          'Far out, where the beam reached and went on reaching, something answered it: the lantern of the night ferry from Cray, a day early and coming in hard against the wind. Her father saw it too. He took one hand from his pocket, thought better of it, and put it back.'
        ],
        summary:
          'At dusk Wren Halloway climbs the hundred and twelve steps of the Gullhaven Light and lights the lamp herself while her father, Edric, watches with his shaking hands hidden in his pockets. The beam sweeps over Gullhaven, and the two of them see the night ferry from Cray coming in a day early against a westerly wind.'
      },
      {
        key: 's2',
        title: 'A Letter for the Keeper',
        status: 'done',
        card: {
          pov: 'wren',
          present: ['wren', 'ansel', 'iska'],
          location: 'gullhaven',
          when: 'Day 1, night',
          goal: 'Bring the stranger and her letter ashore.',
          conflict: 'Iska will give the letter only to Edric; Wren insists she keeps the light.',
          outcome: 'Iska keeps the letter, and admits she knows it is bad news.',
          mood: 'Wet, tense, wary',
          setsUp: ['letter']
        },
        paragraphs: [
          'The harbour at night smelled of tar and wet rope and the fish-gut barrels nobody had emptied. Ansel Crane met Wren at the foot of the quay steps with a lantern in one hand and the ferry’s papers in the other, his harbourmaster’s coat buttoned wrong.',
          '“One passenger,” he said. “One. In this weather. Says she has business with the keeper.” He looked at Wren the way he had looked at her since she was a baby, fond and worried in equal parts. “I told her the keeper was abed.”',
          'The passenger came down the gangway as if the deck were solid ground. She was tall, in a grey travelling coat salt-stained at the hem, and she carried a leather case under her arm as though it held something alive. “Iska Vey,” she said. “From the Harbour Board in Cray. I have a letter for Edric Halloway, sealed, to be put into his hands and no one else’s.”',
          '“I keep the light,” Wren said. “You can give it to me.”',
          '“You light the lamp,” Iska said, not unkindly. “The Board’s books say Edric Halloway keeps it.” She looked up at the headland, where the beam swung out and back, out and back. “I know what it says, if that helps. It doesn’t. I’m sorry.”',
          'Wren held out her hand for the case anyway. Iska Vey did not give it to her. Above them the light went round, and neither of them said what both of them were thinking: that a letter which had to come by night ferry, a day early, in a westerly, was not a letter anyone wanted to read.'
        ],
        summary:
          'At the harbour, Ansel Crane, the harbourmaster, meets the night ferry’s only passenger: Iska Vey, a clerk of the Harbour Board in Cray, with a sealed letter for Edric Halloway’s hands only. Wren says she keeps the light and asks for it, but Iska refuses, admitting she knows what the letter says and that it is bad news.'
      }
    ]
  },
  {
    title: 'The Drowned Steps',
    goal: 'The news lands, and Wren goes looking for a way to fight it.',
    summary:
      'Edric reads the Board’s letter: the light is to be put out at midwinter and a bell buoy set on Bell Rock instead, with a small pension for him. Wren gives herself the seven weeks. At low tide she takes Iska across the Drowned Steps to Bell Rock, tears her palm on the rotted bell rope to show how fast rope fails out there, and the two of them come back as uneasy allies.',
    scenes: [
      {
        key: 's3',
        title: 'What the Letter Said',
        status: 'done',
        card: {
          pov: 'wren',
          present: ['wren', 'edric', 'iska'],
          location: 'light',
          when: 'Day 2, morning',
          goal: 'Reveal what the letter says.',
          conflict: 'Edric takes it quietly; Wren will not.',
          outcome: 'Wren decides to fight for the light before midwinter.',
          mood: 'Still, heavy, then resolved',
          paysOff: ['letter'],
          setsUp: ['midwinter']
        },
        paragraphs: [
          'Her father read the letter at the kitchen table with his spectacles pushed up on his forehead, which was how Wren knew he was not really reading it. He had read it three times already. The wax seal lay in two halves beside the teapot, the Board’s ship-and-tower pressed into it.',
          '“Well,” he said at last. “They’ve done their sums.”',
          'Wren took the letter from him. It was short. The Harbour Board means to put out the Gullhaven Light at midwinter, and to set a bell buoy on Bell Rock in its place, the buoy needing neither oil nor wages nor a keeper. The Charter would be amended. Edric Halloway would be thanked for his long service and given a pension of four shillings a week.',
          '“A bell,” Wren said. “In a fog. On a lee shore.”',
          '“Bells are cheap.” Her father folded his spectacles with great care. “She’s been burning for a hundred and forty years, Wren. Nobody in Cray has ever seen her. Nobody in Cray has ever been out past the Drowned Steps on a winter night and looked for her.”',
          'Iska Vey sat by the stove, her case at her feet, and said nothing. Wren noticed she had not taken off her coat. Somebody who meant to stay would have taken off her coat.',
          '“Midwinter,” Wren said. “That’s seven weeks.” She put the letter down on the table, square to the edge, the way she trimmed a wick. “Right, then. Seven weeks.”'
        ],
        summary:
          'Edric reads the Board’s letter at the kitchen table: the Gullhaven Light is to be put out at midwinter and replaced by a cheap bell buoy on Bell Rock, and he is to be pensioned off. He takes it quietly; Wren does not. With Iska silent by the stove, Wren counts seven weeks to midwinter and resolves to use them.'
      },
      {
        key: 's4',
        title: 'Low Tide',
        status: 'drafted',
        card: {
          pov: 'wren',
          present: ['wren', 'iska'],
          location: 'steps',
          when: 'Day 2, low tide at noon',
          goal: 'Wren shows Iska why a bell can’t do the light’s work.',
          conflict: 'Iska is the Board’s clerk, and fears what writing the truth will cost her.',
          outcome: 'They come back across the steps as uneasy allies.',
          mood: 'Raw, bright, cold'
        },
        paragraphs: [
          'At low tide the Drowned Steps came up out of the sea like the spine of something sleeping: a causeway of old cut stone, green with weed, running from the foot of the headland out to Bell Rock. Twice a day the sea gave it back for an hour. Then it took it again.',
          '“You’ll want to keep up,” Wren told Iska. “The tide doesn’t wait for surveyors.”',
          '“I’m not a surveyor.” Iska was keeping up, though her good boots were not made for weed. “I’m a clerk. They sent me because I’m cheap, the same as the bell.”',
          'On Bell Rock the old tower still stood, roofless, its bell long gone and its rope rotted to a stump. This was where the Board meant to moor the buoy. Wren climbed the broken stair to the top and pulled the last of the rope free to show how far it had rotted, and it took the skin off her left palm as it came.',
          'She held up the stump, blood and all. “This is how long rope lasts out here. This is how long a bell lasts. Write that down.”',
          'Iska looked at the rope, and at the blood, and then out at the water already creeping back over the lowest steps. Something in her face changed. “If I write it down,” she said slowly, “they’ll ask who told me. They’ll ask whether the keeper’s daughter took me out to the rock to make a point.”',
          '“She did,” Wren said. “Tell them that too.”',
          'They went back with the sea at their ankles. Halfway across, without either of them saying anything about it, Iska took Wren’s good hand to steady herself on the weed, and Wren let her.'
        ],
        summary:
          'At low tide Wren leads Iska across the Drowned Steps to Bell Rock, where the Board means to moor its bell buoy. Iska admits she is only a cheap clerk. Wren pulls the rotted bell rope free, tearing her left palm, to show how fast rope fails out there, and tells Iska to write it down. Coming back with the tide rising, Iska takes Wren’s hand and Wren lets her.'
      }
    ]
  }
]

export const SAMPLE_STORY_SUMMARY =
  'In Gullhaven, Wren Halloway keeps the lighthouse in all but name for her ageing father, Edric. A Board clerk, Iska Vey, arrives by night with a letter: the light is to be put out at midwinter and replaced by a bell buoy. Wren gives herself the seven weeks to save it, and shows Iska on Bell Rock why a bell will not do; the two come back uneasy allies.'
