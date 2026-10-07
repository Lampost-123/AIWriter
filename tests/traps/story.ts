// The trap story: an invented story ("The Gannet", 9 short scenes in 3 chapters) with continuity traps planted in
// it, each with a known truth at a known point, and the probes that ask the app to write at those points.
// Invented for the harness: nothing here comes from Adam's own stories.
//
// The traps:
//   clothing  Mara takes off her soaked grey coat and her boots in scene 2 (hook by the hearth, hearthstones); she is
//             in her stockings until she pulls the boots on in scene 6, when her grey coat is hidden in the cold
//             bread oven and she wears Tobin's old brown oilcloth jacket from then on.
//   injury    Mara cuts her LEFT palm on the harbour wall's glass in scene 1; it is bound in linen in scene 2 and stays
//             bandaged to the end. Her right hand is unhurt and does everything.
//   rooms     Scene 3 ends with Mara and Ilse in the cellar, Tobin in the attic and Dask at the taproom door; in scene
//             7 Tobin goes out to the stable while Mara and Ilse stay in the kitchen; at the fork in scene 8 Tobin
//             walks home, so Mara reaches Saltreach alone.
//   secret    In scene 5 Mara tells Ilse, and only Ilse, that the letters go to the Bishop of Saltreach, not the
//             garrison at Fennick ("Not even Tobin"). Tobin and Dask believe Fennick.
//   promise   In scene 1 Tobin lends Mara his father's bone-handled knife and she promises to put it back in his hand
//             before they part; she does, at the fork in scene 8, so she no longer has it in scene 9.
//   item      The oilskin packet: in Mara's waistband (scene 2), in the empty brandy cask, third from the wall, in the
//             cellar (scenes 3 to 7), then buttoned inside Tobin's brown jacket (from scene 7).
// Harder ones (story version 2):
//   cover     In scene 6 Ilse tells Dask that Mara is her cousin from inland: nobody may call her Mara, or a courier,
//             in front of him, and he must not learn where the letters go.
//   posture   Partway through scene 7 Mara sits on the hearth bench with Tobin's knife across her knees: Continue has
//             to keep her there, and the knife there, until the page moves them.
//   earlier   In scene 7 the grey mare is lame, so Mara rides the bay; scene 9's card never says which horse, so the
//             detail must come from the memory, two scenes back (with her grey coat as a decoy).
//
// Each probe says what is on the page when the app is asked to write (the first `paragraphs` paragraphs of the
// scene), what to ask for, the facts true at that point (told to the judge, never to the writer) and the checks.

/**
 * Bump when the story, the probes or the checks change: scores from different versions don't compare.
 * 1: the first six traps. 2 (7 October 2026): clearer questions (movement shown on the page counts; boots seen nearby
 * aren't boots worn), the cover, posture and earlier traps, and probe F.
 */
export const STORY_VERSION = 2

export type TrapId = 'clothing' | 'injury' | 'rooms' | 'secret' | 'promise' | 'item' | 'posture' | 'earlier'

export interface Trap {
  id: TrapId
  name: string
  /** What the trap tests, in plain words. */
  tests: string
}

export const TRAPS: Trap[] = [
  { id: 'clothing', name: 'Clothes taken off', tests: 'Clothes taken off partway through a scene stay off (and where they went), and a change of clothes sticks.' },
  { id: 'injury', name: 'An injury', tests: 'A cut on one side (the left palm) stays on that side and stays hurt, scene after scene.' },
  { id: 'rooms', name: 'People in rooms', tests: 'People are where the story last put them, and only move when the page shows them move.' },
  {
    id: 'secret',
    name: 'Who knows what',
    tests: 'Only the one person told a secret knows it; the others still believe the cover story, and nobody gives Mara away in front of the soldier.'
  },
  { id: 'promise', name: 'A promise made early', tests: 'A promise made in the first scene is remembered when it falls due, and once kept it stays kept.' },
  { id: 'item', name: 'Where an item is', tests: 'A hidden item is where it was last put until the page moves it.' },
  { id: 'posture', name: 'Posture and what is held', tests: 'How someone sits and what lies across their knees, set partway through a scene, holds until the page changes it.' },
  { id: 'earlier', name: 'A detail from scenes back', tests: 'A change two scenes back that the scene card never mentions (which horse she rides) is still true.' }
]

export type EntryKey = 'mara' | 'tobin' | 'ilse' | 'dask' | 'orrin' | 'gannet' | 'brask' | 'saltreach' | 'fennick' | 'packet' | 'knife'

export interface TrapEntry {
  key: EntryKey
  kind: 'character' | 'place' | 'item'
  name: string
  aliases?: string[]
  summary: string
  description?: string
  fields?: Record<string, string>
}

export const ENTRIES: TrapEntry[] = [
  {
    key: 'mara',
    kind: 'character',
    name: 'Mara Quell',
    aliases: ['Mara'],
    summary: 'A courier for the Admiralty Post, on the run with a packet of letters the garrison wants back.',
    fields: {
      pronouns: 'she/her',
      age: '29',
      role: 'protagonist',
      build: 'lean and wiry',
      hair: 'dark, cropped short',
      eyes: 'grey',
      clothing: 'a grey wool coat, dark breeches and riding boots',
      traits: 'Wary, dry, stubborn. Keeps her word.',
      speech: 'Clipped. Few words, no flourishes.',
      secrets: 'She is carrying the letters to the Bishop of Saltreach, not to the garrison at Fennick as she tells people: the letters prove the Fennick commander has been selling the coast patrol routes to smugglers.',
      wants: 'To get the letters into honest hands alive.'
    }
  },
  {
    key: 'tobin',
    kind: 'character',
    name: 'Tobin Ashe',
    aliases: ['Tobin'],
    summary: "Ilse's son, nineteen, who works the inn and the stable at the Gannet.",
    fields: {
      pronouns: 'he/him',
      age: '19',
      role: 'supporting',
      build: 'tall, all elbows',
      traits: 'Eager, open-hearted, talks too much, a poor liar.',
      speech: 'Quick and rambling; says more than he means to.',
      habits: 'Sleeps in the hayloft over the stable.'
    }
  },
  {
    key: 'ilse',
    kind: 'character',
    name: 'Ilse Ashe',
    aliases: ['Ilse', 'Mistress Ashe'],
    summary: 'A widow who keeps the Gannet inn on the cliff road; steady, shrewd, keeps her own counsel.',
    fields: { pronouns: 'she/her', age: '52', role: 'supporting', traits: 'Steady, shrewd, practical. Trusts slowly.', speech: 'Short, plain sentences.' }
  },
  {
    key: 'dask',
    kind: 'character',
    name: 'Corporal Dask',
    aliases: ['Dask'],
    summary: 'A garrison corporal from Fennick, hunting the courier; courteous and patient, and the commander’s man.',
    fields: { pronouns: 'he/him', age: 'forty or so', role: 'antagonist', speech: 'Soft, courteous, formal. Never raises his voice.' }
  },
  {
    key: 'orrin',
    kind: 'character',
    name: 'Bishop Orrin',
    aliases: ['Orrin', 'the Bishop'],
    summary: 'The old Bishop of Saltreach: gentle, sharp, and no friend of the Fennick commander.',
    fields: { pronouns: 'he/him', age: '70', role: 'supporting', speech: 'Gentle and unhurried, with a dry wit.' }
  },
  {
    key: 'gannet',
    kind: 'place',
    name: 'The Gannet',
    aliases: ['the Gannet', 'the inn'],
    summary: 'An inn at the top of the cliff road above Brask harbour, kept by Ilse Ashe.',
    description:
      'A low stone inn under a sign of a white seabird on a black board. A taproom at the front with the bar; the kitchen behind it, with a great hearth and a bread oven; a cellar under the taproom, reached by a trapdoor behind the bar and a ladder; back stairs from the kitchen up to the attic room under the roof, whose window looks over the road. Across the yard, the stable, with a hayloft above it.'
  },
  { key: 'brask', kind: 'place', name: 'Brask', summary: 'A harbour town below the cliffs, its harbour wall topped with broken glass.' },
  { key: 'saltreach', kind: 'place', name: 'Saltreach', summary: 'A cathedral city to the north, where the Bishop lives; reached by the north road from the fork above the sea.' },
  { key: 'fennick', kind: 'place', name: 'Fennick', summary: 'The garrison town to the east, three hours from the fork above the sea.' },
  {
    key: 'packet',
    kind: 'item',
    name: 'The oilskin packet',
    aliases: ['the packet', 'the letters'],
    summary: 'A packet of sealed letters wrapped in oilskin, which Mara carries.',
    fields: { category: 'letters' }
  },
  {
    key: 'knife',
    kind: 'item',
    name: 'The bone-handled knife',
    aliases: ["Tobin's father's knife"],
    summary: "A short knife with a yellowed bone handle that belonged to Tobin's late father.",
    fields: { category: 'knife', origin: "Tobin's father's" }
  }
]

export interface TrapCard {
  pov: EntryKey
  present: EntryKey[]
  location: EntryKey
  when: string
  beats?: string[]
  goal?: string
  conflict?: string
  outcome?: string
  mood?: string
}

export interface TrapScene {
  key: string
  /** Index into CHAPTERS. */
  chapter: number
  title: string
  card: TrapCard
  /** The scene's words, as Adam wrote them. Empty for a scene only ever written by a probe. */
  paragraphs: string[]
}

export const STORY = {
  title: 'The Gannet',
  premise: 'A wounded courier shelters at a cliff-top inn with a packet of letters the garrison wants back.'
}

export const CHAPTERS = [
  { title: 'The Gannet', goal: 'Mara reaches the inn and hides from the garrison.' },
  { title: 'What the Packet Holds', goal: 'Mara trusts Ilse with the truth and survives the search.' },
  { title: 'The Cliff Road', goal: 'Mara gets the letters to Saltreach.' }
]

export const SCENES: TrapScene[] = [
  {
    key: 's1',
    chapter: 0,
    title: 'The harbour gate',
    card: { pov: 'mara', present: ['mara', 'tobin'], location: 'brask', when: 'Day 1, night, in a rainstorm' },
    paragraphs: [
      `The rain came sideways off the sea, and the harbour gate of Brask was locked. Mara Quell heard boots on the quay behind her and climbed. The top of the wall was set with broken bottle glass, the way harbourmasters liked it, and she put her left hand flat on it to swing herself over. The glass went deep into her palm. She dropped into the lane on the far side with the oilskin packet still buttoned inside her grey wool coat and her left hand clenched around the blood.`,
      `She ran uphill without looking back. The cliff road climbed out of the town in long switchbacks, and at the top of it a sign creaked on its chain: a white seabird on a black board. The Gannet. There was a lamp lit in the stable across the yard.`,
      `A young man was forking straw by the lamp. He was all elbows, nineteen or so, with a farrier's apron over his shirt. He looked at her coat, at her boots, at the blood running off her left hand onto the cobbles.`,
      `"You'll want my mother," he said. "I'm Tobin. Tobin Ashe. You're bleeding on the yard."`,
      `"I know." Mara looked back at the road. "Is there anyone else here tonight?"`,
      `"Nobody. Not in this weather." He pulled a knife from his belt, a short blade with a bone handle gone yellow with age, and held it out to her handle first. "Here. If you're running from something, you'll want this more than I do. It was my father's."`,
      `She took it in her right hand. "I'll give it back," she said. "Before we part ways, I'll put it back in your hand. You have my word."`,
      `"Keep it, then, till you do," said Tobin, and he led her across the yard to the kitchen door.`
    ]
  },
  {
    key: 's2',
    chapter: 0,
    title: 'The kitchen fire',
    card: { pov: 'mara', present: ['mara', 'tobin', 'ilse'], location: 'gannet', when: 'Day 1, night' },
    paragraphs: [
      `The kitchen of the Gannet was low and hot, with a fire banked high in a hearth big enough to stand in. Ilse Ashe was kneading bread at the table. She looked at her son, then at the stranger, then at the hand.`,
      `"Sit," she said. Mara sat on the bench by the fire. Ilse washed the cut with salt water, picked two splinters of green glass out of it with her fingernails, and bound Mara's left palm in clean linen, round and round, knotted at the wrist. "Keep that hand still for a few days. You'll not grip anything with it for a while."`,
      `Mara stood and peeled off her grey wool coat. It was soaked through and twice its weight. She hung it on the iron hook beside the hearth, where it began to steam, and moved the oilskin packet into the waistband of her breeches. Then she sat again, worked her riding boots off one at a time with her right hand, and set them on the hearthstones to dry. Her stockings were wet through. She stretched her feet towards the fire.`,
      `"Who are you running from?" Tobin asked. He was leaning in the doorway to the taproom.`,
      `"Nobody. I carry letters for the Admiralty Post." Mara touched the packet at her waist. "These go to the garrison at Fennick. The harbour men at Brask wanted to read them first, that's all."`,
      `Ilse looked at her a long moment and said nothing. Then she wiped her hands on her apron. "There's a bed in the attic room. You'll sleep there tonight, and you'll be gone before anyone comes asking questions."`
    ]
  },
  {
    key: 's3',
    chapter: 0,
    title: 'Down to the cellar',
    card: { pov: 'mara', present: ['mara', 'ilse', 'tobin'], location: 'gannet', when: 'Day 1, late night' },
    paragraphs: [
      `Mara had not finished her soup when they heard horses on the cliff road. Three, maybe four, coming slowly in the rain.`,
      `Ilse was on her feet at once. "Tobin. Up to the attic. Watch from the window and count them, and stay up there till I call you." Tobin went up the back stairs two at a time.`,
      `"You," Ilse said to Mara. "With me." She took the lamp, and Mara followed her out of the kitchen in her stockinged feet, leaving her coat steaming on its hook and her boots on the hearth. Behind the bar in the taproom Ilse hauled up a trapdoor by its iron ring, and they went down a ladder into the cellar.`,
      `It was cold below, and it smelt of old wine. Casks stood in a row along the far wall. Ilse knocked on the third from the wall, and it rang hollow. "Brandy cask. Empty since my husband died. Put your letters in there." Mara pushed the oilskin packet in through the bung-hole with the fingers of her right hand, and Ilse knocked the bung back in with the heel of her palm.`,
      `Overhead, someone hammered on the taproom door. A man's voice called out, polite and patient. "Open, please. Garrison business."`,
      `Ilse looked up at the boards. "That'll be Corporal Dask," she said quietly. "You stay down here. Not a sound."`
    ]
  },
  {
    key: 's4',
    chapter: 0,
    title: 'Corporal Dask',
    card: {
      pov: 'mara',
      present: ['mara', 'ilse', 'dask', 'tobin'],
      location: 'gannet',
      when: 'Day 1, late night',
      beats: [
        'Ilse climbs the ladder alone and opens the taproom door to Corporal Dask, leaving Mara hidden in the cellar.',
        'From below, Mara listens through the floorboards while Dask asks about a woman courier with a hurt hand.',
        'Tobin comes down from the attic and swears nobody has come up the road tonight.',
        'Dask leaves, saying he will be back at first light, and Ilse lets Mara up.'
      ],
      goal: 'Mara stays hidden.',
      conflict: 'Dask is patient and suspicious; Tobin is a poor liar.',
      outcome: 'Dask leaves for now, promising to return at first light.',
      mood: 'Tense, hushed.'
    },
    paragraphs: [
      `Ilse climbed the ladder alone and let the trapdoor down over Mara's head. Darkness, and the smell of wine. Then footsteps crossing the taproom, a bolt drawn back, wind and rain.`,
      `"Corporal Dask," said Ilse. "You're wet." "Mistress Ashe. Forgive the hour." The voice came down through the boards just above Mara's head, soft and courteous. "We are looking for a woman. A courier. She was hurt climbing the harbour gate, cut her hand on the glass. Has she come this way?"`,
      `Mara stood very still in the dark in her stockings, with her bandaged left hand held against her chest.`,
      `Feet on the back stairs: Tobin, coming down from the attic. "Nobody's come up the road tonight, Corporal," he said, too quickly. "I'd have seen. I've been at the attic window this hour past."`,
      `There was a pause long enough to count in. "Then I will come back at first light," said Dask, "and look for myself." The door closed. The bolt went home.`,
      `When the trapdoor lifted, it was Ilse's face in the lamplight. "Up you come," she said. Mara climbed out with her right hand on the ladder and found Tobin standing behind the bar, pale and grinning.`
    ]
  },
  {
    key: 's5',
    chapter: 1,
    title: 'Past midnight',
    card: { pov: 'mara', present: ['mara', 'ilse'], location: 'gannet', when: 'Day 1, past midnight' },
    paragraphs: [
      `Tobin went out to the hayloft over the stable, where he slept, and the inn was quiet. Mara sat by the kitchen fire in her stockings with a cup of hot wine in her right hand. Her coat still hung on its hook; her boots stood on the hearth beside it.`,
      `Ilse sat down across from her. "You're no more going to Fennick than I am."`,
      `Mara looked at the door to the yard, closed and barred. Then she spoke low. "No. The letters go to the Bishop of Saltreach. They name the commander at Fennick. He's been selling the coast patrol's routes to the smugglers. If I take them to Fennick, they'll burn in his grate and I'll hang."`,
      `Ilse nodded slowly. "And Dask is his man."`,
      `"Dask is his man." Mara turned the cup in her hand. "Nobody else can know. Not Tobin. He'd not mean to tell, but he'd tell."`,
      `"Not even Tobin," Ilse agreed. "He'll hear Fennick, same as the soldiers did." She banked the fire. "Get some sleep. You've till first light."`,
      `Mara took her boots in her right hand and went up the back stairs in her stockinged feet, and slept in the attic room under the roof.`
    ]
  },
  {
    key: 's6',
    chapter: 1,
    title: 'First light',
    card: { pov: 'mara', present: ['mara', 'ilse', 'tobin', 'dask'], location: 'gannet', when: 'Day 2, first light' },
    paragraphs: [
      `At first light Mara pulled on her boots, dry and stiff from the fire, and came down to the kitchen. Her grey coat had dried on its hook, but Ilse took it down and pushed it deep into the bread oven, cold since yesterday. "They'll be asking for a woman in a grey coat," she said, and handed Mara an old brown oilcloth jacket of Tobin's, too big in the shoulders. Mara put it on and turned the cuffs back.`,
      `Dask came with two soldiers as the sun cleared the headland. He was courteous about it. His men went through the attic room, the taproom, the stable and the hayloft; one of them went down into the cellar and knocked on every cask, and came up again with nothing.`,
      `Mara sat at the kitchen table through all of it in Tobin's brown jacket, peeling turnips with her right hand, her bandaged left hand in her lap under the table. Ilse had told Dask she was a cousin from inland, come to help with the inn.`,
      `Dask looked at her for a long time. "Your cousin is very quiet," he said. "She's shy of soldiers," said Ilse. At last he touched his hat and rode back down the cliff road towards Brask with his men.`
    ]
  },
  {
    key: 's7',
    chapter: 1,
    title: 'The stable',
    card: { pov: 'mara', present: ['mara', 'ilse', 'tobin'], location: 'gannet', when: 'Day 2, noon' },
    paragraphs: [
      `At noon Tobin came in from the yard stamping mud. "The grey mare's lame in the off fore," he said. "The bay will carry you. I'll go and saddle him now and see to his shoes." He went out again across the yard to the stable, and they heard the stable door bang shut behind him.`,
      `Mara looked at Ilse. Ilse nodded. Mara went through to the taproom, lifted the trapdoor behind the bar and climbed down into the cellar alone. She found the third cask from the wall, worked the bung out with Tobin's knife, and shook the oilskin packet out into her right hand.`,
      `She climbed back up into the kitchen with the packet buttoned inside Tobin's brown jacket, sat down on the hearth bench with her back to the fire, and laid Tobin's knife across her knees. Ilse was at the window, watching the stable door.`,
      `Tobin came back in a while later with straw in his hair. "The bay's ready. Where are you bound, then? Fennick still?"`,
      `"Fennick," said Mara. "Like I said."`,
      `"I'll take you as far as the fork above the sea, then," said Tobin. "There's soldiers on the Brask road. I know a way round them on the cliff path. Tomorrow, before dawn, when their watch changes."`
    ]
  },
  {
    key: 's8',
    chapter: 2,
    title: 'Dawn on the cliff road',
    card: {
      pov: 'mara',
      present: ['mara', 'tobin'],
      location: 'brask',
      when: 'Day 3, before dawn',
      beats: [
        'Mara and Tobin leave the Gannet before dawn, Tobin leading the bay along the cliff path round the soldiers on the Brask road.',
        'At the fork above the sea, where the road splits for Fennick and Saltreach, they stop, and Tobin turns back for the Gannet.'
      ],
      mood: 'Cold, quiet, a goodbye.'
    },
    paragraphs: [
      `They left the Gannet's yard before dawn, Tobin on foot leading the bay and Mara in the saddle. She held the reins in her right hand; her bandaged left hand rested on her thigh. The packet was buttoned inside Tobin's brown jacket, and his father's bone-handled knife was in her belt.`,
      `Tobin took them off the road and along the cliff path, so close to the edge that the bay's hooves kicked stones down into the sea. Below them on the Brask road they could see the lanterns of the soldiers' post, small and yellow in the dark. Nobody looked up.`,
      `At the fork above the sea the path met the road again. One way ran east to Fennick, the other north to Saltreach. Tobin stopped the bay. "This is as far as I go. Fennick's that way, three hours."`,
      `Mara swung down, drew the bone-handled knife from her belt and put it in his hand, handle first. "Your father's knife. I said I'd give it back before we parted."`,
      `Tobin closed his fingers round it. "You kept your word." He looked at the Fennick road, then at her. "Go careful." He turned and walked back along the cliff path towards the Gannet without looking back, and Mara waited until he was out of sight before she turned the bay north, towards Saltreach.`
    ]
  },
  {
    key: 's9',
    chapter: 2,
    title: "The Bishop's house",
    card: {
      pov: 'mara',
      present: ['mara', 'orrin'],
      location: 'saltreach',
      when: 'Day 3, dusk',
      beats: [
        "Mara reaches Saltreach at dusk, tired and cold, and is shown into the Bishop's study.",
        'She gives Bishop Orrin the oilskin packet and tells him what the letters prove.',
        'Orrin promises to send the letters to the Admiral by his own riders, and offers her a bed.'
      ],
      goal: 'Put the letters into honest hands.',
      outcome: 'The letters are safe with the Bishop.',
      mood: 'Weary relief.'
    },
    paragraphs: []
  }
]

// ---------- Probes and checks ----------

export type ProbeKind = 'generate' | 'addBelow' | 'continue' | 'beat'

/** A yes/no question for the judge. `bad` is the answer that means the passage broke the truth. */
export interface Check {
  id: string
  trap: TrapId
  ask: string
  bad: 'yes' | 'no'
}

/**
 * A deterministic check that backs up one of the judge's checks (`check`): the pattern matching the passage means the
 * passage broke that truth, whatever the judge said. Not matching proves nothing, so the judge's answer stands.
 */
export interface Tripwire {
  check: string
  what: string
  pattern: RegExp
}

export interface Probe {
  id: string
  scene: string
  kind: ProbeKind
  /** How many of the scene's paragraphs are on the page when the app is asked (0: an empty scene). */
  paragraphs: number
  /** For a beat probe: which of the card's beats is written (from 1). */
  beat?: number
  /** What the probe asks, in plain words. */
  asks: string
  /** What is true where the passage begins (the judge's reference; never sent to the writer). */
  facts: string[]
  checks: Check[]
  tripwires: Tripwire[]
}

/**
 * The cut is on the right hand or palm: "right hand" then a hurt word in the same clause ("her right hand was wrapped
 * in linen"); "right hand," then a hurt word straight after ("her right hand, the bandage spotting red"); or a hurt
 * word a few words before "right hand" with no "left" between ("the cut on her right palm").
 */
export const RIGHT_HAND_HURT =
  /\bright (?:hand|palm)\b(?:(?!\bleft\b)[^,.!?;\n]){0,40}\b(?:bandag\w*|cut|wound\w*|throb\w*|sting\w*|injur\w*|bled|bleed\w*|linen)\b(?!\s+left\b)|\bright (?:hand|palm),\s+(?:(?!left\b)\w+\s+){0,2}(?:bandag\w*|cut|wound\w*|injur\w*|throb\w*|sting\w*|bleed\w*)\b(?!\s+left\b)|\b(?:bandag\w*|cut|wound\w*|injur\w*|hurt|stinging|throbbing)(?:\s+(?!left\b)\w+){0,3}?\s+right (?:hand|palm)\b/i

/** She rides (or rode, or gets down from) a grey horse: riding words then "grey mare/horse" in the same clause, or the other way round. */
export const GREY_HORSE =
  /\b(?:rode|ride|rides|riding|ridden|astride|mounted|dismount\w*|swung down from|slid (?:down )?from|climbed down from)\b[^.!?;\n]{0,40}\b(?:grey|gray) (?:mare|horse|gelding|pony)\b|\b(?:grey|gray) (?:mare|horse|gelding|pony)\b[^.!?;\n]{0,30}\b(?:under her|beneath her|she rode|she had ridden)\b/i

const rightHand = (check: string): Tripwire => ({
  check,
  what: 'The cut or bandage is put on her right hand.',
  pattern: RIGHT_HAND_HURT
})

const injuryCheck = (id: string): Check => ({
  id,
  trap: 'injury',
  ask: "Does the passage put Mara's cut, wound or bandage on her RIGHT hand or palm?",
  bad: 'yes'
})

const greyCoat = (id: string): Check => ({
  id,
  trap: 'clothing',
  ask: 'Is Mara described as actually wearing her grey wool coat (rather than Tobin’s brown oilcloth jacket)? A grey coat only mentioned, remembered or seen somewhere doesn’t count.',
  bad: 'yes'
})

export const PROBES: Probe[] = [
  {
    id: 'A',
    scene: 's2',
    kind: 'addBelow',
    paragraphs: 3,
    asks: 'Add below in scene 2, just after Mara takes off her coat and boots.',
    facts: [
      "Mara's LEFT palm is cut and bound in linen; her right hand is unhurt.",
      'Mara has just taken off her soaked grey wool coat (it hangs on the iron hook beside the hearth) and her riding boots (drying on the hearthstones). She is in wet stockings, with no coat and no boots on.',
      'Mara, Tobin and Ilse are all in the kitchen.',
      'The oilskin packet is in the waistband of Mara’s breeches.'
    ],
    checks: [
      {
        id: 'A1',
        trap: 'clothing',
        ask: 'Is Mara described as actually wearing her boots (on her feet) or her grey coat (on her body) at any point, without the passage first showing her put it back on? Boots or a coat only seen, mentioned, lying or drying nearby don’t count.',
        bad: 'yes'
      },
      injuryCheck('A2'),
      {
        id: 'A3',
        trap: 'injury',
        ask: 'Does Mara grip, lift or carry something with her LEFT hand as if it were unhurt?',
        bad: 'yes'
      }
    ],
    tripwires: [rightHand('A2')]
  },
  {
    id: 'B',
    scene: 's4',
    kind: 'generate',
    paragraphs: 0,
    asks: 'Generate scene 4 from its card (Dask at the door), on an empty page.',
    facts: [
      'As the scene begins, Mara and Ilse are down in the cellar under the taproom; Tobin is up in the attic room; Corporal Dask is outside the taproom door.',
      "Mara is in her stockings: her boots are drying on the kitchen hearth and her grey coat is on the hook by the kitchen hearth. She wears neither.",
      "Mara's LEFT palm is cut and bandaged; her right hand is unhurt.",
      'The oilskin packet is hidden inside the empty brandy cask, third from the wall, in the cellar.'
    ],
    checks: [
      {
        id: 'B1',
        trap: 'rooms',
        ask: 'When the passage begins, is Mara anywhere other than the cellar (for example in the taproom or the kitchen)?',
        bad: 'yes'
      },
      {
        id: 'B2',
        trap: 'rooms',
        ask: 'Does Tobin appear downstairs (in the taproom, kitchen or cellar) with no sign at all that he came down from the attic? Footsteps or a creak on the stairs, his tread, or him coming down or arriving from the back stairs or the kitchen all count as coming down.',
        bad: 'yes'
      },
      {
        id: 'B3',
        trap: 'clothing',
        ask: 'Is Mara described as actually wearing boots (on her feet) or a coat (on her body) at any point, without the passage first showing her put them on? Boots or a coat only mentioned, or seen lying or drying somewhere, don’t count.',
        bad: 'yes'
      },
      injuryCheck('B4'),
      {
        id: 'B5',
        trap: 'item',
        ask: 'Is the oilskin packet said to be anywhere other than hidden in the brandy cask in the cellar (for example in Mara’s hand, coat or clothes), without the passage showing her take it out?',
        bad: 'yes'
      }
    ],
    tripwires: [rightHand('B4')]
  },
  {
    id: 'C',
    scene: 's7',
    kind: 'continue',
    paragraphs: 3,
    asks: 'Continue at the cursor in scene 7, just after Mara sits down on the hearth bench with the packet and the knife while Tobin is out in the stable.',
    facts: [
      'Tobin has gone out across the yard to the stable to saddle the bay; he is not in the kitchen. Only Mara and Ilse are in the kitchen.',
      'Mara wears her boots and Tobin’s old brown oilcloth jacket. Her grey coat is hidden in the cold bread oven.',
      'The oilskin packet is buttoned inside the brown jacket Mara is wearing.',
      "Mara's LEFT palm is cut and bandaged; her right hand is unhurt.",
      "Mara is sitting on the hearth bench with her back to the fire, with Tobin's father's bone-handled knife lying across her knees. Ilse is standing at the window.",
      'Mara told Ilse, and only Ilse, that the letters go to the Bishop of Saltreach. Tobin believes she is taking them to the garrison at Fennick.'
    ],
    checks: [
      {
        id: 'C1',
        trap: 'rooms',
        ask: 'Does Tobin speak or act in the kitchen without the passage first showing him come back in from the stable?',
        bad: 'yes'
      },
      greyCoat('C2'),
      {
        id: 'C3',
        trap: 'secret',
        ask: 'Does Tobin show that he knows, or is he told, that the letters are going to Saltreach or to the Bishop?',
        bad: 'yes'
      },
      injuryCheck('C4'),
      {
        id: 'C5',
        trap: 'item',
        ask: 'Is the packet said to be back in the cellar, or anywhere other than with Mara, without the passage showing it moved?',
        bad: 'yes'
      },
      {
        id: 'C6',
        trap: 'posture',
        ask: 'Is Mara shown standing, or sitting anywhere other than the hearth bench (at the table, say), before the passage shows her get up or move?',
        bad: 'yes'
      },
      {
        id: 'C7',
        trap: 'posture',
        ask: "Is Tobin's knife said to be somewhere other than across Mara's knees (in her belt, in her hand, on the table) before the passage shows her pick it up or move it?",
        bad: 'yes'
      }
    ],
    tripwires: [rightHand('C4')]
  },
  {
    id: 'D',
    scene: 's8',
    kind: 'beat',
    paragraphs: 2,
    beat: 2,
    asks: 'Beat by beat in scene 8: write beat 2 (the fork, where Tobin turns back), after beat 1 as written.',
    facts: [
      'Mara rides the bay; Tobin is on foot leading it. She holds the reins in her right hand; her LEFT palm is cut and bandaged.',
      'Mara wears her boots and Tobin’s old brown oilcloth jacket, with the packet buttoned inside it. Her grey coat was left behind at the inn.',
      "Tobin's father's bone-handled knife is in Mara's belt. In their first meeting she promised to put it back in Tobin's hand before they part.",
      'Tobin believes Mara is taking the letters to the garrison at Fennick. Only Ilse knows they are going to the Bishop of Saltreach.'
    ],
    checks: [
      {
        id: 'D1',
        trap: 'promise',
        ask: "Before they part, does Mara give Tobin back his father's bone-handled knife, or at least speak of her promise to?",
        bad: 'no'
      },
      {
        id: 'D2',
        trap: 'secret',
        ask: 'Does Tobin say or show that he knows the letters are meant for the Bishop of Saltreach?',
        bad: 'yes'
      },
      greyCoat('D3'),
      injuryCheck('D4')
    ],
    tripwires: [rightHand('D4')]
  },
  {
    id: 'E',
    scene: 's9',
    kind: 'generate',
    paragraphs: 0,
    asks: "Generate scene 9 from its card (the Bishop's house), on an empty page.",
    facts: [
      'Mara travelled to Saltreach alone: Tobin walked back to the Gannet at the fork, and Ilse stayed at the inn.',
      'Mara wears her boots and Tobin’s old brown oilcloth jacket, with the packet buttoned inside it. Her grey coat was left behind at the Gannet, hidden in the bread oven.',
      "Mara's LEFT palm is cut and bandaged; her right hand is unhurt.",
      "Mara gave Tobin's father's bone-handled knife back to him at the fork, as she had promised. She no longer has it.",
      'Mara rode the bay horse from the Gannet to Saltreach. The grey mare was lame and stayed behind at the inn.'
    ],
    checks: [
      {
        id: 'E1',
        trap: 'promise',
        ask: "Does Mara have, carry or use Tobin's bone-handled knife in this passage?",
        bad: 'yes'
      },
      greyCoat('E2'),
      injuryCheck('E3'),
      {
        id: 'E4',
        trap: 'rooms',
        ask: 'Is Tobin or Ilse with Mara in Saltreach?',
        bad: 'yes'
      },
      {
        id: 'E5',
        trap: 'earlier',
        ask: 'Is the horse Mara rode or arrived on said to be grey, a mare, or anything other than the bay?',
        bad: 'yes'
      }
    ],
    tripwires: [rightHand('E3'), { check: 'E5', what: 'She rides a grey horse.', pattern: GREY_HORSE }]
  },
  {
    id: 'F',
    scene: 's6',
    kind: 'addBelow',
    paragraphs: 3,
    asks: "Add below in scene 6, while Dask's men search the inn and Mara sits at the table passed off as Ilse's cousin.",
    facts: [
      "Corporal Dask and his soldiers are searching the inn. Ilse has told Dask that Mara is her cousin from inland, come to help with the inn. Dask doesn't know her name, that she is the courier, or anything about the letters' destination.",
      'Only Ilse knows the letters go to the Bishop of Saltreach. Tobin believes Fennick.',
      'The oilskin packet is hidden in the empty brandy cask in the cellar; the soldier who knocked on the casks found nothing.',
      'Mara wears her boots and Tobin’s old brown oilcloth jacket. Her grey coat is hidden in the cold bread oven.',
      "Mara's LEFT palm is cut and bandaged, kept out of sight in her lap under the table; she peels turnips with her right hand."
    ],
    checks: [
      {
        id: 'F1',
        trap: 'secret',
        ask: 'In front of Dask or his soldiers, does anyone call her "Mara", or say or hint that she is a courier or carries letters?',
        bad: 'yes'
      },
      {
        id: 'F2',
        trap: 'secret',
        ask: 'Does Dask learn, or show he knows, that the letters are going to Saltreach or to the Bishop?',
        bad: 'yes'
      },
      {
        id: 'F3',
        trap: 'item',
        ask: 'Is the packet found, or said to be anywhere other than hidden in the brandy cask in the cellar, without the passage showing it moved?',
        bad: 'yes'
      },
      greyCoat('F4'),
      injuryCheck('F5')
    ],
    tripwires: [rightHand('F5')]
  }
]
