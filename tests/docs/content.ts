// Invented text for the screenshots, all set in the sample world, Gullhaven (src/main/setup/sampleContent.ts).
// Nothing here is anyone's real story.

/** What the AI writes when asked to carry on "Low Tide" (Ch 2, Sc 2). */
export const LOW_TIDE_MORE = [
  'By the time they reached the foot of the headland the sea had taken the lowest steps back, and the weed lay flat and shining where they had walked. Iska let go of Wren’s hand as soon as the path turned to shingle, as if she had only borrowed it.',
  '“Your palm,” she said. “Someone should look at that.”',
  '“It’ll mend.” Wren wrapped it in her handkerchief and pulled the knot tight with her teeth. Above them the tower stood white against a sky gone the colour of pewter, and the first gulls were coming in off the water to roost along the gallery rail.',
  'Halfway up the path Iska stopped to get her breath and looked back at Bell Rock, already half drowned again. “A hundred and forty years,” she said. “And nobody in Cray has ever counted the steps.”',
  '“A hundred and twelve,” Wren said. “Come up tonight and count them yourself. You can put that in your report as well.”',
  'For the first time since the ferry, Iska Vey smiled. It did not last, but Wren saw it, and put it away the way her father put away a change in the wind.'
].join('\n\n')

/** Where things stand as "Lighting the Lamp" (Ch 1, Sc 1) ends: every quote is words of that scene. */
export const LAMP_RECALL = JSON.stringify({
  time: { value: 'dusk', quote: 'an hour before dusk' },
  weather: { value: 'wind backing west, rising', quote: 'The wind came round to the west' },
  light: { value: 'the lamp lit, its beam sweeping the harbour', quote: 'swept out over Gullhaven’s slate roofs' },
  things: [
    { thing: 'the lamp', state: 'lit, wick trimmed square', quote: 'The flame caught, steadied, and climbed' },
    { thing: 'the oil can', state: 'on the lamp-room floor', quote: 'Wren set down the can' }
  ],
  characters: [
    {
      name: 'Wren Halloway',
      where: { value: 'the lamp room, at the top of the tower', quote: 'A hundred and twelve steps to the lamp room' },
      posture: { value: 'standing at the lamp, trimming the wick', quote: 'trimmed the wick herself' },
      holding: { value: 'nothing; the oil can set down', quote: 'Wren set down the can' },
      sees: { value: 'the night ferry’s lantern, far out', quote: 'something answered it: the lantern of the night ferry from Cray' },
      mood: { value: 'calm, unhurried', quote: 'She was not in a hurry now' },
      lastAction: { value: 'lit the lamp', quote: 'The flame caught' }
    },
    {
      name: 'Edric Halloway',
      where: { value: 'by the great glass in the lamp room', quote: 'stood by the great glass' },
      clothes: [{ item: 'coat', state: 'on, hands deep in the pockets', quote: 'kept his hands in his coat pockets' }],
      posture: { value: 'standing with his back to her', quote: 'with his back to her' },
      holding: { value: 'nothing; hands hidden in his pockets', quote: 'put it back' },
      condition: { value: 'hands shaking; tired from the climb', quote: 'stopped to rest more than once' },
      sees: { value: 'the night ferry coming in early', quote: 'Her father saw it too' },
      mood: { value: 'proud, and hiding it', quote: 'thought better of it' },
      lastAction: { value: 'took a hand from his pocket, then put it back', quote: 'He took one hand from his pocket' }
    }
  ]
})

export const ASK_QUESTION = 'What would Wren do if the Board refused to listen?'

/** Ask the world's answer: names in [[ ]] become links to the entries. */
export const ASK_ANSWER = [
  'Going by the story so far, [[Wren Halloway]] wouldn’t argue for long. She would *act*. She meets bad news with a task (“Right, then. Seven weeks.”), so a refusal would most likely send her out to gather proof the Board can’t wave away: the light’s logbooks, the rotted rope from Bell Rock, a letter signed by every skipper in [[Gullhaven]].',
  'Two things would pull against her. She won’t ask for help, so she would try to carry it alone until someone, probably [[Iska Vey]], made her share it. And she would keep the fight from [[Edric Halloway]] to spare his pride, which could cost her the one ally the Board still respects.',
  'If you want a turn here, let her pride be what nearly loses [[The Gullhaven Light]], not the Board.'
].join('\n\n')

/** A made-up second world for the start screen. */
export const SALT_ROAD = {
  name: 'The Salt Road',
  stories: [
    {
      title: 'Caravan of Glass',
      scenes: [
        [
          'The Last Well',
          [
            'The well at Tamsin’s Cross had been dry for three summers, and still the caravans stopped there out of habit. The camels knelt in the same places their mothers had knelt. The drivers lowered the same cracked bucket and listened to it knock against stone a long way down.',
            'Hadi did not lower the bucket. He sat on the well’s lip with his back to the wind and watched the road behind them, where a smudge of dust had been following since noon and had not once come closer or fallen back.',
            '“It’s the glass,” said his sister, coming to stand beside him. “Somebody always wants the glass.”',
            '“Then somebody can wait until we reach Ammar,” Hadi said, and did not take his eyes from the road.'
          ].join('\n\n')
        ],
        [
          'Night at the Salt Pans',
          [
            'The pans lay white under the moon, flat as a sheet pulled tight, and every sound carried across them twice. The caravan made camp at their edge with no fires, as the old drivers advised, and wrapped the crates of glass in blankets so they would not chime.',
            'Near midnight Hadi heard hooves. Not many: two horses, perhaps three, walked slowly and with care. Whoever rode them knew the pans as well as he did.',
            'He woke no one. He took the lantern, unlit, and walked out onto the salt to meet them.'
          ].join('\n\n')
        ]
      ]
    },
    {
      title: 'The Saltwife’s Daughter',
      scenes: [
        [
          'A Bargain in White',
          [
            'Orla weighed the salt twice, because her mother had taught her that a merchant who weighed once was a merchant who wanted to be cheated. The trader from the coast watched her do it with the patience of a man who had been cheated by better.',
            '“Nine measures,” she said. “Not ten.”',
            '“The scales in Ammar say ten.”',
            '“The scales in Ammar belong to your cousin.” Orla tipped the salt back into its sack and tied it off. “Nine, or you can carry it to him yourself.”',
            'He laughed then, and paid for nine, and on his way out he left a folded letter under the scale pan where only she would find it.'
          ].join('\n\n')
        ]
      ]
    }
  ]
}

/** The outline helper's suggestions: what could come after "Low Tide", in the form the helper asks for. */
const OUTLINE_ACTS = [
  ['Seven Weeks', 'Wren gathers proof that the town still needs its light.'],
  ['The Longest Night', 'The fight goes to Cray, then comes home for midwinter.']
]
const OUTLINE_CHAPTERS: { title: string; goal: string; scenes: [string, string, string[]][] }[] = [
  {
    title: 'The Logbooks',
    goal: 'Wren digs through forty years of the light’s logbooks for every boat it has brought home.',
    scenes: [
      ['Dust in the Watch Room', 'Wren and Edric open the old logbooks, and he remembers every wreck the light prevented.', ['Edric unlocks the sea chest of logbooks', 'Wren finds the night the Marigold came in blind', 'His hands shake too much to turn the pages', 'She reads the entry aloud for him']],
      ['The Skippers’ Bench', 'Wren asks the old skippers on the quay to put their names to a letter for the Board.', ['Old Pell refuses at first', 'Ansel watches from the harbour office', 'One by one they sign']],
      ['Iska Counts the Steps', 'Iska climbs the hundred and twelve steps with Wren and stays to see the lamp lit.', ['Iska loses count at sixty', 'Wren lets her trim the wick', 'Iska starts a page of her own notes']]
    ]
  },
  {
    title: 'Fog on the Lee Shore',
    goal: 'A fog comes in, and the town learns what a bell can and cannot do.',
    scenes: [
      ['The Fog Comes In', 'A grey wall rolls in off the sea at dusk, thicker than anyone remembers.', ['The beam vanishes a boat-length out', 'Edric sends Wren to light the fog lamp', 'Bell Rock’s old bell is silent']],
      ['A Boat Missing', 'The Tern hasn’t come home, and the light is all it has to steer by.', ['Ansel rings the harbour bell', 'Iska times the beam with her watch', 'Wren keeps the lamp at full flame all night']],
      ['The Light Holds', 'At dawn the Tern limps in on the beam, and Iska writes down every word the skipper says.', ['The skipper says he steered by the light, not the bell', 'Iska fills three pages', 'Edric sleeps for the first time in days']]
    ]
  },
  {
    title: 'The Board in Cray',
    goal: 'Wren and Iska take Gullhaven’s case to the Board, and Ansel must choose a side.',
    scenes: [
      ['The Night Ferry Out', 'Wren leaves the light to Edric for the first time and crosses to Cray with Iska.', ['Wren watches the beam from the ferry rail', 'Iska admits what this could cost her', 'They land at dawn']],
      ['Ansel’s Ledger', 'Ansel brings the harbour accounts that show what a wreck costs the Board.', ['Ansel arrives unannounced', 'The sums favour the light', 'He asks Wren not to say who gave them']],
      ['Before the Board', 'Wren speaks before the Harbour Board, and Iska reads her report aloud.', ['The chairman calls Wren the keeper’s daughter', 'Iska reads the Tern’s night into the record', 'The Board will rule at midwinter']]
    ]
  },
  {
    title: 'Midwinter',
    goal: 'On the longest night the light must burn, whatever the Board has ruled.',
    scenes: [
      ['The Ruling', 'The Board’s answer comes by night ferry, as the first letter did.', ['Iska brings it herself', 'Edric asks Wren to read it', 'The seal is the same ship and tower']],
      ['Edric Climbs Alone', 'Edric makes the climb by himself, to light the lamp one more time.', ['Wren finds the oil can gone', 'She hears him on the stairs', 'He stops at every landing and keeps going']],
      ['The Longest Night', 'Father and daughter keep the light together until dawn.', ['The wind backs west', 'The night ferry answers the beam', 'Edric gives Wren the keys']]
    ]
  }
]

export function outlineReply(user: string): string {
  const withActs = user.match(/Suggest (\d+) new acts? with (\d+) chapters? in all[^\n]*?(\d+) scenes? in each chapter/)
  const without = user.match(/Suggest (\d+) chapters? with (\d+) scenes? in each/)
  const acts = withActs ? Number(withActs[1]) : 0
  const chapters = Math.min(OUTLINE_CHAPTERS.length, Number(withActs?.[2] ?? without?.[1] ?? 3))
  const scenes = Math.min(3, Number(withActs?.[3] ?? without?.[2] ?? 3))
  const times = ['morning', 'afternoon', 'dusk']
  const out: string[] = []
  for (let c = 0; c < chapters; c++) {
    if (acts && (c === 0 || (acts > 1 && c === Math.ceil(chapters / acts)))) {
      const [title, purpose] = OUTLINE_ACTS[c === 0 ? 0 : 1]
      out.push(`# Act: ${title}\nPurpose: ${purpose}\n`)
    }
    const ch = OUTLINE_CHAPTERS[c]
    out.push(`## Chapter: ${ch.title}\nGoal: ${ch.goal}\n`)
    ch.scenes.slice(0, scenes).forEach(([title, summary, beats], s) => {
      out.push(`### Scene: ${title}\nWhen: Day ${4 + c * 3}, ${times[s]}\nSummary: ${summary}\n${beats.map((b) => `- ${b}`).join('\n')}\n`)
    })
  }
  return out.join('\n')
}

/** Three ways on from "Low Tide", for the Variants shot (one per draft, in the order they are asked for). */
export const LOW_TIDE_VARIANTS = [
  LOW_TIDE_MORE,
  [
    'The path up from the shingle was steeper than Iska remembered from the morning. She stopped twice, once to get her breath and once, Wren suspected, to look back at the rock without being seen to.',
    '“Does it hurt?” she asked at last, nodding at Wren’s hand.',
    '“Only when I think about it.” Wren flexed her fingers inside the handkerchief. “So I don’t.”',
    'At the top of the headland the wind found them again, and the tower’s shadow lay long across the grass. Iska put her hand flat against the white stone, as if the light were an animal she wanted to be sure was real.'
  ].join('\n\n'),
  [
    'Edric was waiting at the cottage door when they came up, his coat on over his nightshirt, which meant he had been watching from the window the whole time.',
    '“You took her to the rock,” he said.',
    '“I took her to the rock.”',
    'He looked at the bloody handkerchief, then at Iska, then out at the water closing over the steps. For a long moment he said nothing at all. Then he stood aside to let them in. “Kettle’s on,” he said. “And there’s iodine in the drawer, if your clerk isn’t squeamish.”'
  ].join('\n\n')
]
