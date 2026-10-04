// The genre presets for "Story feel" on the Style guide screen. Picking one (or two, to blend) tells the
// writer model what the genre implies for the prose: pacing, sentence rhythm, how much description and inner
// thought, how dialogue runs, how scenes open and close, and the genre's own stale moves to steer clear of.
// Every word here is written for AI Write. Ids are stored in style guides, so never rename one.

export interface GenrePreset {
  /** Stored in the style guide's `genres`. Never change an id once shipped. */
  id: string
  label: string
  /** A lucide icon name for the tile (the interface maps it to the icon). */
  icon: string
  /** The tile's hue (0 to 360, OKLCH); the theme sets lightness and chroma. */
  hue: number
  /** One line under the tile once it is picked. */
  blurb: string
  /** How the genre should read, for the writer model (about 80 words). */
  guidance: string
  /** A short phrase for the closing reminder: "Keep the <feel> of <label>". */
  feel: string
  /** The genre's stale moves, steered clear of in the prompt. */
  cliches: string[]
}

export const GENRES: readonly GenrePreset[] = [
  {
    id: 'fantasy',
    label: 'Fantasy',
    icon: 'WandSparkles',
    hue: 285,
    blurb: 'Wonder grounded in a world that works by its own rules.',
    guidance:
      'Make the world feel lived in rather than explained: show customs, magic and history through what characters use, fear and argue about, never through lectures. Use invented words confidently and let context carry their meaning. Give magic a cost and limits the reader can feel. Balance wonder with grit: weather, hunger, sore feet. Let description breathe at arrivals and turning points, then move briskly. Dialogue should carry each culture\'s manners without slipping into faux-archaic speech.',
    feel: 'grounded wonder',
    cliches: [
      'a chosen one whose destiny is announced by a prophecy',
      'a wise mentor who dies just as the hero needs him',
      'a farm boy who turns out to be secret royalty',
      'a tavern scene that exists only to start the quest',
      'magic with no cost or limit',
      'an evil that is evil for its own sake',
      'elders who explain the history in one long speech'
    ]
  },
  {
    id: 'dark-fantasy',
    label: 'Dark fantasy',
    icon: 'Moon',
    hue: 300,
    blurb: 'Fantasy in shadow, where the uncanny has teeth.',
    guidance:
      'Keep the wonder but let it unsettle: magic should feel dangerous, old and only half understood. Build atmosphere through decay, silence and wrongness in small things. Let the moral ground be uncertain, with allies who are compromised and choices without clean answers. Use restraint with horror: suggest before you show. Sentences can lengthen into mood, then cut short at the moment of threat. Let scenes end on unease rather than relief, and let victories leave a mark.',
    feel: 'creeping, uncanny dread',
    cliches: [
      'a cackling dark lord',
      'corruption shown only as black veins or glowing eyes',
      'gore used as a shortcut to darkness',
      'every character brooding in the same voice',
      'a pure-hearted hero untouched by the world',
      'ancient evil awakening with no sense of what it wants'
    ]
  },
  {
    id: 'grimdark',
    label: 'Grimdark',
    icon: 'Swords',
    hue: 15,
    blurb: 'Hard worlds, harder people, and no clean victories.',
    guidance:
      'Write a world where power is brutal and ideals are expensive. Let characters be self-interested, wry and capable of cruelty and of small, costly decency. Show violence as fast, ugly and consequential, with wounds that linger. Favour blunt, physical prose and gallows humour over speeches. Keep the camera close to mud, fatigue and fear. Let plans fail in believable ways. End scenes on a hard turn or a grim joke, not on uplift, and never let cynicism become a pose.',
    feel: 'hard-edged grit and gallows humour',
    cliches: [
      'cruelty shown for shock with no consequence',
      'every character equally cynical and interchangeable',
      'swearing standing in for personality',
      'a grizzled mercenary with a heart of gold',
      'darkness so total that nothing matters',
      'battle scenes that read like a list of wounds'
    ]
  },
  {
    id: 'sci-fi',
    label: 'Sci-fi',
    icon: 'Rocket',
    hue: 220,
    blurb: 'Ideas made human: technology seen through its consequences.',
    guidance:
      'Show technology through what it changes in daily life, work and relationships, not through how it works. Never pause for an explanation the characters wouldn\'t need: let jargon arrive in use and trust the reader. Keep procedure plausible and consistent. Let the big idea press on the characters\' choices. Prose can be clean and exact, with precise sensory detail of machines, light and environments. Dialogue should sound like people who take their world for granted.',
    feel: 'precise, idea-driven clarity',
    cliches: [
      'a character explaining technology to someone who already knows it',
      '"as you know" dialogue',
      'an AI that turns evil for no reason',
      'a ship\'s computer voice used as a narrator',
      'alien cultures with a single trait',
      'technobabble that solves the problem at the last moment'
    ]
  },
  {
    id: 'horror',
    label: 'Horror',
    icon: 'Ghost',
    hue: 0,
    blurb: 'Slow-building dread, with the worst left half seen.',
    guidance:
      'Build dread slowly and hold the release. Start with the ordinary and let small wrongnesses accumulate: a sound in the wrong place, a detail that shouldn\'t be there. Keep what is frightening partly unseen and unexplained. Use the senses heavily, especially sound and touch. Lengthen sentences as tension builds, then shorten them hard at the turn. Let characters act sensibly and still be trapped. Prefer dread over gore, and end scenes on a question or a door left open.',
    feel: 'slow-building dread',
    cliches: [
      'a jump scare that turns out to be a cat',
      'characters splitting up for no reason',
      'the monster fully explained by the end',
      'a creepy child singing a nursery rhyme',
      'a sceptic who refuses to believe until it is too late',
      'gore used in place of fear',
      'it was all a dream'
    ]
  },
  {
    id: 'thriller',
    label: 'Thriller',
    icon: 'Timer',
    hue: 25,
    blurb: 'Momentum and stakes, with the clock always ticking.',
    guidance:
      'Keep momentum high: enter scenes late and leave early, with each one raising the stakes or narrowing the options. Favour short paragraphs, active verbs and concrete action. Let competence show through what characters do under pressure. Keep the ticking clock present without stating it every page. Use reversals and withheld information, but play fair with the reader. Description should be quick and functional. End scenes on a hook, a new threat or a hard decision.',
    feel: 'relentless momentum',
    cliches: [
      'a villain who explains the whole plan',
      'a hacker who breaks any system in seconds',
      'a phone with no signal at the vital moment',
      'a twist that contradicts what came before',
      'the hero surviving impossible odds with no cost',
      'a mole revealed as the one person never suspected'
    ]
  },
  {
    id: 'mystery',
    label: 'Mystery',
    icon: 'Search',
    hue: 195,
    blurb: 'Fair clues, sharp observation and a satisfying turn.',
    guidance:
      'Play fair: plant real clues in plain sight among natural detail, and give red herrings their own logic. Let the investigator notice things through precise observation, and let the reader notice them too. Keep suspects distinct, each with something to hide. Dialogue carries much of the work: evasions, slips and contradictions. Pace with steady revelations and small reversals. Keep description sharp and selective, because every detail might matter. End scenes on a new question or a fact that changes the picture.',
    feel: 'sharp, fair-play curiosity',
    cliches: [
      'the detective gathering everyone for a speech that explains everything',
      'a clue the reader was never shown',
      'a confession with no pressure behind it',
      'a murderer who is the least likely person for no reason',
      'a detective whose only trait is brilliance',
      'a convenient coincidence solving the case'
    ]
  },
  {
    id: 'romance',
    label: 'Romance',
    icon: 'Heart',
    hue: 350,
    blurb: 'Tension, longing and the emotional beat above the event.',
    guidance:
      'Put the emotional beat first: what each moment means to the relationship matters more than what happens. Stay close to the point-of-view character\'s feelings, body and doubts. Build tension slowly, through near misses, small touches and things unsaid, then let it pay off. Give both leads agency, wants and wounds. Dialogue should spark, with banter and subtext doing the flirting. Let scenes end on a shift in the relationship, and keep the promise of a hopeful ending.',
    feel: 'slow-burning tension and longing',
    cliches: [
      'a misunderstanding a single honest sentence would fix',
      'a love interest who is only cold and brooding',
      'a jealous rival who exists only to be mean',
      'falling in love with no reason beyond looks',
      'the heroine tripping into his arms',
      'a grand gesture that ignores what the other person said they wanted'
    ]
  },
  {
    id: 'romantasy',
    label: 'Romantasy',
    icon: 'Sparkles',
    hue: 320,
    blurb: 'A fantasy world where the love story drives the plot.',
    guidance:
      'Weave the romance and the world together, so each raises the stakes of the other: politics, magic and danger should press on the relationship, and the relationship should change the plot. Stay close to the point-of-view character\'s longing and conflict. Build tension through rivalry, forced proximity and divided loyalties, paying it off slowly. Keep world detail vivid but brisk. Let dialogue spark with banter and subtext. End scenes on an emotional turn or a dangerous choice.',
    feel: 'charged romance in a dangerous world',
    cliches: [
      'a fated-mates bond that removes any need for courtship',
      'a powerful love interest whose only trait is danger',
      'the heroine discovering she is the most powerful being alive',
      'a love triangle with no real choice in it',
      'magic that awakens only through a kiss',
      'world-building that stops whenever the leads are alone'
    ]
  },
  {
    id: 'erotica',
    label: 'Erotica',
    icon: 'Flame',
    hue: 5,
    blurb: 'Adult fiction where desire and sex drive the story.',
    guidance:
      'Desire is the engine: sex scenes between consenting adults are central and written openly on the page, unless the content levels say otherwise. Build heat through anticipation, power and negotiation, so each encounter changes the characters or their relationship. Stay inside the point-of-view character\'s sensations, wants and nerves, with specific, physical detail rather than vague euphemism. Keep consent and adulthood clear. Vary pace: linger in the charged moments, move briskly between them. Dialogue can be frank, playful or tender. End scenes on a shift in power or intimacy.',
    feel: 'frank, charged sensuality',
    cliches: [
      'a sex scene told only as feelings, with the acts left off the page',
      'coy euphemisms for body parts',
      'partners who never speak, hesitate or laugh',
      'instant, effortless perfection every time',
      'a plot that exists only to get from one scene to the next',
      'the same moves and words in every encounter'
    ]
  },
  {
    id: 'literary',
    label: 'Literary',
    icon: 'Feather',
    hue: 160,
    blurb: 'Subtext, precise images and endings that open out.',
    guidance:
      'Favour subtext and restraint: let meaning gather in gesture, image and what goes unsaid. Choose the precise, surprising detail over the expected one. Let interior life be layered and contradictory, with memory and present moment overlapping. Vary rhythm deliberately; long sentences are fine when they earn their length. Avoid neat lessons and tidy epiphanies. Dialogue should be oblique and true to how people talk past each other. End scenes on an image or a quiet shift that opens rather than closes.',
    feel: 'restraint and quiet precision',
    cliches: [
      'an epiphany stated outright at the end',
      'weather mirroring the character\'s mood',
      'a dying parent used only to trigger reflection',
      'lyrical description with nothing at stake',
      'a character staring out of a window remembering',
      'symbols the narration points at'
    ]
  },
  {
    id: 'historical',
    label: 'Historical',
    icon: 'Landmark',
    hue: 40,
    blurb: 'The past made immediate, in its own manners and limits.',
    guidance:
      'Let the period live through texture: objects, work, food, smells, money and manners, woven into action rather than catalogued. Keep characters\' attitudes and knowledge true to their time while making their feelings immediate. Use period flavour in dialogue lightly, with no modern slang and no stiff pastiche. Let the era\'s constraints shape the plot: travel, class, law, illness. Keep research invisible. Pace like the genre the story is underneath, and end scenes on a human turn.',
    feel: 'lived-in period texture',
    cliches: [
      'a modern-minded heroine who alone sees through her era',
      'characters explaining well-known events to each other',
      'famous historical figures dropping in for cameos',
      'period detail listed like a museum label',
      'dialogue stuffed with "thee" and "thou" for flavour',
      'everyone in the past being dirty, stupid or cruel'
    ]
  },
  {
    id: 'adventure',
    label: 'Adventure',
    icon: 'Compass',
    hue: 130,
    blurb: 'Journeys, daring and the thrill of the unknown.',
    guidance:
      'Keep the story moving through places and obstacles, with each set piece testing the characters in a new way. Make landscapes vivid and physical: heat, height, water, distance. Let action be clear and easy to follow, with cause and effect on the page. Give the companions friction and humour. Favour energetic, concrete prose with momentum. Let danger be real and setbacks cost something. End scenes on a new horizon, a narrow escape or a choice about which way to go.',
    feel: 'daring, forward momentum',
    cliches: [
      'a map with an X that leads straight to the treasure',
      'a rope bridge that breaks exactly as the last person crosses',
      'natives who exist only to help or hinder the heroes',
      'the hero never tiring or getting hurt',
      'a traitor in the crew with no motive',
      'escaping a collapsing temple at the end'
    ]
  },
  {
    id: 'comedy',
    label: 'Comedy',
    icon: 'Laugh',
    hue: 55,
    blurb: 'Timing, escalation and characters who mean it.',
    guidance:
      'Let comedy come from character and situation: people who want things badly and go about them in ways that backfire. Escalate steadily, with each fix making things worse. Play it straight: the characters shouldn\'t know they\'re funny. Use timing, short beats and well-placed specifics, and save the punchline for the end of the sentence. Keep description lean. Let dialogue crackle with misunderstanding and wit. Allow real feeling underneath. End scenes on a reversal or a last, perfect line.',
    feel: 'quick timing and escalating trouble',
    cliches: [
      'characters laughing at their own jokes',
      'a pun used as a punchline',
      'slapstick with no reason behind it',
      'a joke explained after it lands',
      'everyone being equally quippy',
      'humour that mocks someone for who they are'
    ]
  },
  {
    id: 'cosy',
    label: 'Cosy',
    icon: 'Coffee',
    hue: 75,
    blurb: 'Warmth, community and low stakes that still matter.',
    guidance:
      'Make the world a place the reader wants to stay: warm interiors, good food, familiar faces and small rituals. Keep stakes personal and gentle, with problems solved through kindness, cleverness and community rather than violence. Let conflict exist but never turn cruel. Give side characters charm and quirks. Prose can be relaxed and sensory, with room for small pleasures. Dialogue should be friendly and lightly funny. End scenes on comfort, connection or a small mystery to look forward to.',
    feel: 'warmth and gentle comfort',
    cliches: [
      'a heroine who inherits a shop in a quaint village',
      'every villager being a one-note eccentric',
      'sweetness with no tension at all',
      'a love interest who is simply perfect',
      'problems that solve themselves',
      'a cat that is wiser than everyone'
    ]
  }
]

/** The most genres a style guide blends. */
export const MAX_GENRES = 2

const byId = new Map(GENRES.map((g) => [g.id, g]))

/** The preset with this id, or null for an id this version doesn't know. */
export function genreById(id: string): GenrePreset | null {
  return byId.get(id) ?? null
}

/** Known genre ids from stored data, in order, without repeats, at most MAX_GENRES. */
export function cleanGenres(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const id of v) {
    if (typeof id === 'string' && byId.has(id) && !out.includes(id)) out.push(id)
    if (out.length >= MAX_GENRES) break
  }
  return out
}

/** The presets for these ids (unknown ids left out). */
export function genresOf(ids: readonly string[]): GenrePreset[] {
  return cleanGenres(ids).map((id) => byId.get(id)!)
}

/** The genre picks in a few words: "Horror", "Fantasy with Romance". */
export function genreLabel(ids: readonly string[]): string {
  const g = genresOf(ids)
  if (!g.length) return ''
  if (g.length === 1) return g[0].label
  return `${g[0].label} with ${g[1].label.toLocaleLowerCase()}`
}
