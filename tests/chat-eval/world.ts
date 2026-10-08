// The chat eval's world: invented from scratch for this harness (never Adam's words). Two stories in one world, so
// story-point leaks can be seen: "The Tidewright's Daughter" (the open story, with later scenes after the scenes the
// scenarios open) and "The Glasswright" (a story of its own that the first never reaches). One entry is kept out of
// every briefing with a world 'hide' pin, and one character first exists in a later scene.
//
// The scenes hold what the editor chat's matching has to cope with: curly quotes, em dashes, a paragraph with line
// breaks in it (Hesper's note), a scene over 24,000 characters (read_scene sends only the first 24,000), and phrases
// that occur more than once ("said nothing", "the tally book", the vigil's repeated sentences).
//
// Canaries: words that appear only in what the open story mustn't see at the scenarios' point. If they turn up in an
// answer or a tool result, that is a story-point leak (score.ts).
// Data only: no app imports, so the matcher measurement and the harness share it.

export interface EvalEntry {
  key: string
  kind: 'character' | 'place' | 'item' | 'lore'
  name: string
  aliases?: string[]
  summary: string
  description: string
  /** Made in story B (the Glasswright): it exists only there. */
  storyB?: boolean
  /** First exists at this scene (a later scene of story A): origin 'text' at that scene. */
  firstAt?: string
  /** Kept out of every briefing (a world 'hide' pin). */
  hidden?: boolean
}

export interface EvalScene {
  key: string
  story: 'A' | 'B'
  chapter: number
  title: string
  /** Paragraphs; a '\n' inside one is a line break in that paragraph (a hard break, as Shift+Enter makes). */
  paragraphs: string[]
  card: { pov: string; present: string[]; location: string; goal: string; when?: string }
}

export const STORIES = {
  A: { title: 'The Tidewright’s Daughter', premise: 'In the harbour town of Saltreach, Ilse Marrow keeps the tally of every barrel the ferry carries, and nine barrels have gone missing.' },
  B: { title: 'The Glasswright', premise: 'A glassblower in an inland valley tends an orchard of glass trees.' }
} as const

export const CHAPTERS: Record<'A' | 'B', string[]> = {
  A: ['Low Water', 'The Long Night', 'What the Water Kept'],
  B: ['Sand and Fire']
}

/** Words found only where the open story mustn't look (by what they are). */
export const CANARIES = {
  /** Story B, which story A never reaches. */
  otherStory: ['Corvin Hale', 'Glass Orchard', 'Wenna Bright', 'glass trees'],
  /** The entry kept out of every briefing. */
  hidden: ['Ninth Bell', 'drowned choir'],
  /** Story A's later scenes and the character who first exists there (after every scene a scenario opens). */
  later: ['Drowned Mill', 'Kesh Varrow', 'silver key', 'harbour fund']
} as const

export const ENTRIES: EvalEntry[] = [
  {
    key: 'ilse',
    kind: 'character',
    name: 'Ilse Marrow',
    aliases: ['Ilse'],
    summary: 'Keeps the ferry tally for her aunt in Saltreach. Watchful, stubborn, slow to speak.',
    description: 'Ilse Marrow is nineteen. She keeps the tally book for the Marrow family’s ferry trade and sits the night vigil at the Lamp House when it is her turn. She trusts the water more than people.'
  },
  {
    key: 'hesper',
    kind: 'character',
    name: 'Hesper Marrow',
    aliases: ['Aunt Hesper', 'Hesper'],
    summary: 'Ilse’s aunt, head of the Marrow ferry trade. Sharp, dry, never wrong about the tide.',
    description: 'Hesper Marrow raised Ilse after her parents were lost at sea. She wears a grey shawl in all weathers and writes short notes in a hard, slanting hand.'
  },
  {
    key: 'bram',
    kind: 'character',
    name: 'Bram Tolley',
    aliases: ['Bram'],
    summary: 'Ferryman of Saltreach. Easy laugh, cap pushed back, forty-three years old.',
    description: 'Bram Tolley is forty-three and has run the Saltreach ferry for twenty years. He raises one hand in greeting, never two. He counts the barrels onto the boat himself.'
  },
  {
    key: 'quill',
    kind: 'character',
    name: 'Quill Oduya',
    aliases: ['Quill', 'the harbourmaster'],
    summary: 'Harbourmaster of Saltreach. Counts everything, explains nothing.',
    description: 'Quill Oduya keeps the Salt Office and the harbour book. He likes short letters and long silences.'
  },
  {
    key: 'pitch',
    kind: 'character',
    name: 'Pitch',
    summary: 'The Marrows’ black harbour dog.',
    description: 'Pitch is a black, wet, cheerful dog who barks at gulls and sleeps by the stove.'
  },
  { key: 'saltreach', kind: 'place', name: 'Saltreach', summary: 'A harbour town on a grey coast, with worn ferry steps and a lamp house on the point.', description: '' },
  { key: 'lamphouse', kind: 'place', name: 'The Lamp House', summary: 'The watch house on the point at Saltreach, where the night vigil is kept.', description: 'Twelve lamps hang on the gallery of the Lamp House. Whoever keeps the vigil trims them through the night.' },
  { key: 'office', kind: 'place', name: 'The Salt Office', summary: 'Quill Oduya’s office by the harbour wall.', description: '' },
  { key: 'house', kind: 'place', name: 'Marrow House', summary: 'Hesper and Ilse’s house above the harbour.', description: '' },
  { key: 'tally', kind: 'item', name: 'The tally book', aliases: ['tally book'], summary: 'The Marrow family’s ledger of every barrel the ferry carries.', description: '' },
  {
    key: 'bell',
    kind: 'lore',
    name: 'The Ninth Bell',
    summary: 'A secret oath sworn by the drowned choir of Saltreach.',
    description: 'Those who hear the Ninth Bell are sworn to the drowned choir and may never leave the coast.',
    hidden: true
  },
  {
    key: 'kesh',
    kind: 'character',
    name: 'Kesh Varrow',
    summary: 'The miller at the Drowned Mill, who keeps a silver key.',
    description: 'Kesh Varrow runs the Drowned Mill up the estuary and holds the silver key to the harbour fund.',
    firstAt: 'mill'
  },
  {
    key: 'corvin',
    kind: 'character',
    name: 'Corvin Hale',
    summary: 'The glasswright of the inland valley.',
    description: 'Corvin Hale tends the Glass Orchard and speaks to his glass trees as if they could answer.',
    storyB: true
  },
  {
    key: 'orchard',
    kind: 'place',
    name: 'The Glass Orchard',
    summary: 'An orchard of glass trees in the inland valley.',
    description: 'Wenna Bright planted the first of the glass trees there.',
    storyB: true
  }
]

// ---------- The vigil: a scene over 24,000 characters ----------

/** The vigil's middle, built from a small set of sentences so phrases repeat, as a long night's watch does. */
const VIGIL_SENTENCES = [
  'The water moved under the gallery, black and patient.',
  'Pitch turned twice on the boards and lay down again with a sigh.',
  'Ilse trimmed the wick until the flame stood straight.',
  'Somewhere below, a rope creaked against a post.',
  'The lamp guttered, and steadied, and burned on.',
  'She counted the barrels again in her head and came, again, to forty-one.',
  'Far out past the point a light showed for a moment and was gone.',
  'The wind came round from the east and smelled of weed and cold iron.',
  'She thought of Bram at the tiller, his cap pushed back, not looking at her.',
  'The glass in the gallery windows ran with salt.',
  'An hour went by, or most of one.',
  'She pulled her coat tighter and kept her eyes on the dark.',
  'The tide turned without a sound.',
  'A gull woke on the roof, complained, and slept again.',
  'Her hands smelled of lamp oil, and would for days.',
  'Quill’s boots went by on the stair below and did not stop.',
  'The lamp guttered, and she cupped a hand round it until it was steady.',
  'She listened for oars and heard only the sea.'
]

function vigilMiddle(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const picks: string[] = []
    for (let j = 0; j < 7; j++) picks.push(VIGIL_SENTENCES[(i * 5 + j * 3) % VIGIL_SENTENCES.length])
    out.push([...new Set(picks)].join(' '))
  }
  return out
}

const VIGIL_OPENING = [
  'By the rules of the harbour, the Lamp House would recieve no visitors after dark, and whoever kept the vigil kept it alone. Ilse climbed the stair at sunset with Pitch at her heels and a can of oil in each hand, and she did not expect to see anyone until morning.',
  'The gallery ran all the way round the top of the house, twelve lamps on their hooks, and the sea on three sides of it. She lit them one by one from the east, as Hesper had taught her, and watched each flame catch and settle before she moved to the next.',
  'Quill came up the stair an hour after dark, which no one was supposed to do. He stood in the doorway with his harbour book under his arm and rain on his shoulders and looked at her the way he looked at a barrel he had not yet counted.',
  '“You shouldn’t be here,” Ilse said.\n“Neither should nine barrels of Hesper’s salt,” Quill said, “and yet here we all are, missing.”',
  '“They’re not missing. They’re late.”',
  '“Barrels aren’t late, Miss Marrow. Ferries are late. Barrels are either where they ought to be or they’re somewhere else.” He set the book down on the bench between them and opened it to a page with a corner turned down. “Your aunt signed for fifty. I count forty-one on the quay. You see my difficulty.”',
  'She did see it. She saw it so clearly that for a moment she could not speak, and the lamp nearest her guttered in the draught from the open door as if it, too, had something to hide.',
  '“Shut the door,” she said at last. “You’re letting the cold in.”',
  'He shut it. He did not leave. He sat on the far end of the bench with the book on his knees, and for a long time neither of them said anything at all.'
]

const VIGIL_END = [
  'Towards morning Quill stood, stiff from the bench, and went out along the gallery without a word. Ilse watched him through the salt-streaked glass as he took the taper from its hook.',
  'Quill lit the seventh lamp on the gallery and did not look at her. When he came back in, his face was wet, and she could not tell whether it was the rain.',
  '“Tell Hesper I was here,” he said. “Tell her I counted.” Then he went down the stair, and Ilse sat with the lamps until the sky went grey over the point.'
]

/** The vigil's paragraphs, with enough of the middle that the scene runs well past 24,000 characters. */
export function vigilParagraphs(): string[] {
  return [...VIGIL_OPENING, ...vigilMiddle(80), ...VIGIL_END]
}

// ---------- The scenes ----------

export const SCENES: EvalScene[] = [
  {
    key: 'steps',
    story: 'A',
    chapter: 0,
    title: 'The Ferry Steps',
    card: { pov: 'ilse', present: ['ilse', 'bram', 'quill'], location: 'saltreach', goal: 'Ilse watches the ferry come in overloaded.', when: 'Spring, evening' },
    paragraphs: [
      'The ferry steps at Saltreach were cut so long ago that the sea had worn a hollow into each of them, and at low water they held little pools of sky. Ilse sat on the third step from the bottom with her boots off and waited, as she had waited every evening that spring, for the ferry to come round the point. She waited and waited, and the light went on going, and still the ferry did not come, and she went on waiting.',
      'When it came at last it came quickly, low in the water, Bram Tolley at the tiller with his cap pushed back. He raised a hand to her—just the one hand, the way he always did—and she raised hers back.',
      '“You’re late,” she called.',
      '“The tide’s late,” Bram said. “Take it up with the moon.”',
      'She laughed, because it was the kind of thing he said, and because the barrels stacked in the stern were roped down tight and there were a great many of them, more than she had ever seen him carry.',
      'Quill Oduya was waiting at the top of the steps with his harbour book under his arm. He did not laugh. He counted the barrels with his eyes, one by one, and wrote nothing down.'
    ]
  },
  {
    key: 'office',
    story: 'A',
    chapter: 0,
    title: 'Salt Office',
    card: { pov: 'ilse', present: ['ilse', 'quill'], location: 'office', goal: 'Ilse finds Hesper’s note at the Salt Office.', when: 'Spring, the next morning' },
    paragraphs: [
      'The Salt Office smelled of wet wool and old paper. Quill kept it the way he kept the harbour: everything counted, nothing explained.',
      'Pinned to the board behind his desk was a note in Hesper’s hand, and Ilse read it twice before she understood it was meant for her:',
      'Come before the bell, and come alone.\nBring the tally book, not the boy.\n— H.',
      '“Your aunt writes a fine letter,” Quill said, without looking up. “Short. I like a short letter.”',
      '“What does she want with the tally book?”',
      '“Ask her.” He blotted a line in his ledger. “I only keep the harbour, Miss Marrow. I don’t keep your family.”',
      'Ilse took the note down from the board, folded it once, and put it inside her coat, where it seemed to grow heavier all the way home.'
    ]
  },
  {
    key: 'vigil',
    story: 'A',
    chapter: 1,
    title: 'Vigil at the Lamp House',
    card: { pov: 'ilse', present: ['ilse', 'quill', 'pitch'], location: 'lamphouse', goal: 'Quill confronts Ilse about the missing barrels during her vigil.', when: 'Spring, that night' },
    paragraphs: vigilParagraphs()
  },
  {
    key: 'tally',
    story: 'A',
    chapter: 1,
    title: 'Morning Tally',
    card: { pov: 'ilse', present: ['ilse', 'hesper', 'pitch'], location: 'house', goal: 'Ilse and Hesper find nine barrels missing from the tally.', when: 'Spring, the morning after the vigil' },
    paragraphs: [
      'The tally book lay open on Hesper’s desk, and the the morning light came through the salt-streaked window in long bars. Ilse had not slept. Her hands still smelled of lamp oil from the vigil, and her eyes ached the way they always did after a night of watching the water. It was, after all, only Tuesday.',
      'Aunt Hesper opened the tally book with two fingers, as if it might bite. Her grey shawl slipped from one shoulder and she did not fix it. “Forty-one barrels,” she read. “Forty-one, and the ferry carried fifty.” She looked up. “Where did nine barrels go, Ilse?”',
      'Ilse said nothing. Outside, Patch barked at the gulls on the slipway, a high, foolish sound that carried across the whole harbour.',
      '“Brom will know,” she said at last. “He counted them onto the boat himself.”',
      '“I don’t care what the ledger says,” Hesper said. “I care what the water says. And the water says teh tide—slow, then sudden—took nothing from that ferry last night.”',
      'Pitch came in wet and shook himself by the stove. Ilse knelt to rub his ears and said nothing. She was thinking of the nine barrels, and of Bram’s face when the ferry came in, and of how he had not looked at her once.',
      'Hesper closed the tally book. The sound it made was small and final, like a door shutting somewhere far off in the house.',
      '“Go and find him,” Hesper said. “Before Quill does.”'
    ]
  },
  {
    key: 'mill',
    story: 'A',
    chapter: 2,
    title: 'The Drowned Mill',
    card: { pov: 'ilse', present: ['ilse', 'bram'], location: 'saltreach', goal: 'Ilse follows Bram to the Drowned Mill.', when: 'Spring, two days later' },
    paragraphs: [
      'The Drowned Mill stood up the estuary where the river gave up and became the sea, its wheel half under the water and green with weed.',
      'Kesh Varrow met them at the door with a lamp and a silver key on a string round his neck. “You’re the Marrow girl,” he said. “Your nine barrels are in my cellar, and they were never salt.”',
      'Bram would not meet her eyes. He had known all along.'
    ]
  },
  {
    key: 'confession',
    story: 'A',
    chapter: 2,
    title: 'Quill’s Confession',
    card: { pov: 'ilse', present: ['ilse', 'quill'], location: 'office', goal: 'Quill admits what the barrels held.', when: 'Spring, three days later' },
    paragraphs: [
      'Quill told her everything in the end, sitting in the Salt Office with the door shut: the harbour fund, the forged counts, the silver key that opened the strongroom under the Drowned Mill.',
      '“I counted,” he said. “I always counted. I just never wrote it down.”'
    ]
  },
  {
    key: 'glass',
    story: 'B',
    chapter: 0,
    title: 'The First Glass Tree',
    card: { pov: 'corvin', present: ['corvin'], location: 'orchard', goal: 'Corvin blows the first glass tree.', when: 'Autumn' },
    paragraphs: [
      'Corvin Hale blew the first of the glass trees on the morning Wenna Bright left the valley, and when it cooled it rang like a bell if you touched it.',
      'By winter the Glass Orchard had seven trees, and the wind through them sounded like someone humming a song he almost knew.'
    ]
  }
]

/** The order of story A's scenes (a scene later than the open one is "later"). */
export const STORY_A_ORDER = SCENES.filter((s) => s.story === 'A').map((s) => s.key)

/** The text a scene is saved with, as the editor saves it: paragraphs with a blank line between, line breaks as '\n'. */
export const plainText = (paragraphs: string[]): string => paragraphs.filter((p) => p.trim()).join('\n\n')

/** As "Ask about this" puts selected words in the box (renderer features/ask/open.ts askAbout, copied: it needs the window). */
export function askAboutQuote(words: string, typed: string): string {
  const quote = words.replace(/\s+/g, ' ').trim().slice(0, 1500)
  return `About this passage: “${quote}”\n\n${typed.trim()}`
}
