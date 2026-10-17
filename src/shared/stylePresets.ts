// Writing style presets (Adam, 2026-10-17: "collect writing style presets, including more adult themes"): one click
// sets a story's (or the world's) whole style at once: its genres, content levels, point of view, tense, prose style
// and tone. Everything stays editable afterwards in the Style guide, and applying one is undone from its toast.
// Presets marked `adult` write for adult readers (explicit sex, graphic violence or strong language); the picker
// shows them under their own heading. Every word here is AI Write's own (the repository is public). Never change
// an id once shipped: it may be remembered as the last preset picked.

import type { ContentIntensity, StyleGuide } from './types'

export interface StylePreset {
  id: string
  label: string
  /** One line under its name. */
  blurb: string
  /** For adult readers: shown under "For adult readers". */
  adult: boolean
  /** The tone it gives the story (a few words). */
  tone: string
  style: Pick<StyleGuide, 'pov' | 'tense' | 'proseStyle' | 'genres' | 'genreNotes'> & { intensity: ContentIntensity }
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  // ----- For everyone -----
  {
    id: 'epic-fantasy',
    label: 'Epic fantasy',
    blurb: 'Big stakes, many voices, a world with deep history.',
    adult: false,
    tone: 'Sweeping, earnest and hard-won',
    style: {
      pov: 'Third person limited, moving between a few point-of-view characters by chapter',
      tense: 'Past',
      proseStyle:
        'Measured, textured prose that lets the world breathe at arrivals and turning points and moves briskly in action. Concrete sensory detail over abstraction. History and magic come through what people use, fear and argue about, never lectures. Dialogue carries each culture’s manners without faux-archaic speech.',
      genres: ['fantasy', 'adventure'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 2 }
    }
  },
  {
    id: 'cosy-mystery',
    label: 'Cosy mystery',
    blurb: 'A puzzle, a warm community, nothing too grisly.',
    adult: false,
    tone: 'Warm, witty and curious',
    style: {
      pov: 'First person, the amateur sleuth',
      tense: 'Past',
      proseStyle:
        'Light, conversational and wry, with an eye for small domestic detail. Clues are planted fairly in plain sight. Short chapters that end on a new question. Humour comes from character, never at the victim’s expense.',
      genres: ['mystery', 'cosy'],
      genreNotes: '',
      intensity: { romance: 2, violence: 1, language: 1 }
    }
  },
  {
    id: 'pacy-thriller',
    label: 'Pacy thriller',
    blurb: 'Short chapters, ticking clocks, cliffhangers.',
    adult: false,
    tone: 'Tense, urgent and propulsive',
    style: {
      pov: 'Close third person, alternating between protagonist and antagonist',
      tense: 'Past',
      proseStyle:
        'Lean and fast: short paragraphs, strong verbs, little description outside what matters to the danger. Each scene has a clock or a threat. Chapters end on a turn or a reveal. Exposition is cut to the bone and delivered under pressure.',
      genres: ['thriller'],
      genreNotes: '',
      intensity: { romance: 2, violence: 3, language: 3 }
    }
  },
  {
    id: 'lyrical-literary',
    label: 'Lyrical literary',
    blurb: 'Rich interiority, careful sentences, quiet power.',
    adult: false,
    tone: 'Reflective, intimate and bittersweet',
    style: {
      pov: 'Close third person, deep in one character’s mind',
      tense: 'Past',
      proseStyle:
        'Precise, musical sentences that vary in length and rhythm. Imagery drawn from the character’s own life, used sparingly so it lands. Rich inner thought; subtext in dialogue. Scenes turn on small gestures. Endings resonate rather than resolve.',
      genres: ['literary'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 2 }
    }
  },
  {
    id: 'spare-minimalist',
    label: 'Spare and minimal',
    blurb: 'Plain words, short sentences, what is left unsaid.',
    adult: false,
    tone: 'Understated and stark',
    style: {
      pov: 'Third person, close but reserved',
      tense: 'Past',
      proseStyle:
        'Short declarative sentences and plain, concrete words. No adverbs where a verb will do. Emotion lives in action and in what characters avoid saying. Dialogue is clipped and natural, with few tags beyond “said”.',
      genres: ['literary'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 2 }
    }
  },
  {
    id: 'hard-sci-fi',
    label: 'Grounded science fiction',
    blurb: 'Ideas with consequences, technology that feels real.',
    adult: false,
    tone: 'Curious, cool-headed and awed',
    style: {
      pov: 'Third person limited',
      tense: 'Past',
      proseStyle:
        'Clear, exact prose that treats technology as everyday to the characters: no explaining what they would take for granted. Ideas are tested through choices and their costs. Wonder is earned through scale and precision rather than adjectives.',
      genres: ['sci-fi'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 2 }
    }
  },
  {
    id: 'gothic',
    label: 'Gothic',
    blurb: 'Old houses, family secrets, creeping unease.',
    adult: false,
    tone: 'Brooding, atmospheric and uncanny',
    style: {
      pov: 'First person, looking back',
      tense: 'Past',
      proseStyle:
        'Atmospheric, slightly formal prose heavy with place: weather, decay, candlelight, sounds in empty rooms. Dread builds slowly through what is glimpsed and half-explained. The past presses on the present.',
      genres: ['horror', 'historical'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 1 }
    }
  },
  {
    id: 'romcom',
    label: 'Romantic comedy',
    blurb: 'Banter, mishaps, and a happy ending.',
    adult: false,
    tone: 'Bright, funny and heartfelt',
    style: {
      pov: 'First person, alternating between the two leads by chapter',
      tense: 'Present',
      proseStyle:
        'Breezy, voice-led prose with quick banter and comic timing. Set-pieces of escalating embarrassment. The emotional beats are sincere underneath the jokes. The leads are kept apart by believable reasons, not misunderstandings a single conversation would fix.',
      genres: ['romance', 'comedy'],
      genreNotes: '',
      intensity: { romance: 2, violence: 1, language: 2 }
    }
  },
  {
    id: 'young-adult',
    label: 'Young adult voice',
    blurb: 'Immediate, emotional, a teen narrator’s eyes.',
    adult: false,
    tone: 'Urgent, raw and hopeful',
    style: {
      pov: 'First person, the teenage protagonist',
      tense: 'Present',
      proseStyle:
        'An immediate, distinctive teen voice: honest, funny and intense about everything at once. Feelings are big and named. Short chapters, quick scenes, strong hooks. Adults are rarely the ones who solve things.',
      genres: ['adventure'],
      genreNotes: '',
      intensity: { romance: 2, violence: 2, language: 2 }
    }
  },
  // ----- For adult readers -----
  {
    id: 'steamy-romance',
    label: 'Steamy romance',
    blurb: 'Slow-burn tension and open-door love scenes.',
    adult: true,
    tone: 'Sensual, emotional and warm',
    style: {
      pov: 'Close third person, alternating between the two leads',
      tense: 'Past',
      proseStyle:
        'Emotionally rich prose that lingers on attraction: glances, touch, breath, the tension of what isn’t said. Love scenes are on the page and grounded in feeling and consent, building from earlier tension. Banter and vulnerability in equal measure. Happy ending.',
      genres: ['romance'],
      genreNotes: '',
      intensity: { romance: 3, violence: 1, language: 3 }
    }
  },
  {
    id: 'explicit-romance',
    label: 'Explicit romance',
    blurb: 'Sex scenes written in full, with the heart intact.',
    adult: true,
    tone: 'Heated, intimate and frank',
    style: {
      pov: 'First person, alternating between the two leads by chapter',
      tense: 'Present',
      proseStyle:
        'Frank, physical and emotionally honest. Sex scenes are written in full, explicit and specific, with enthusiastic consent and each partner’s inner life kept front and centre. Desire drives plot choices. Dirty talk sounds like people, not porn clichés. Aftermath matters as much as the act.',
      genres: ['romance', 'erotica'],
      genreNotes: '',
      intensity: { romance: 4, violence: 1, language: 4 }
    }
  },
  {
    id: 'dark-romance',
    label: 'Dark romance',
    blurb: 'Dangerous love, morally grey leads, high heat.',
    adult: true,
    tone: 'Obsessive, intense and dangerous',
    style: {
      pov: 'First person, alternating between the heroine and the morally grey lead',
      tense: 'Present',
      proseStyle:
        'Intense, claustrophobic prose charged with power games, possessiveness and danger. Explicit sex on the page. Violence is real and has weight. The leads are morally grey and unapologetic; the romance is the centre of the story and ends with them together.',
      genres: ['romance', 'thriller'],
      genreNotes: 'Content warnings belong at the front of the book, not in the prose.',
      intensity: { romance: 4, violence: 3, language: 4 }
    }
  },
  {
    id: 'spicy-romantasy',
    label: 'Spicy romantasy',
    blurb: 'Fae courts, enemies to lovers, open door.',
    adult: true,
    tone: 'Lush, dangerous and seductive',
    style: {
      pov: 'First person, the heroine',
      tense: 'Present',
      proseStyle:
        'Lush, sensory prose that blends court intrigue and magic with a slow-burn romance that turns explicit. Banter with an edge; desire that complicates loyalties. Fights and magic have real cost. Sex scenes on the page and in full.',
      genres: ['romantasy', 'fantasy'],
      genreNotes: '',
      intensity: { romance: 4, violence: 3, language: 3 }
    }
  },
  {
    id: 'erotica',
    label: 'Erotica',
    blurb: 'Desire is the story. Fully explicit.',
    adult: true,
    tone: 'Sensual, bold and uninhibited',
    style: {
      pov: 'Close third person',
      tense: 'Past',
      proseStyle:
        'The story is built around sexual encounters between consenting adults, each one escalating and revealing character. Fully explicit, blunt body words and direct talk, no fading out. Plot and setting are present but serve the desire.',
      genres: ['erotica'],
      genreNotes: '',
      intensity: { romance: 4, violence: 1, language: 4 }
    }
  },
  {
    id: 'grimdark',
    label: 'Grimdark',
    blurb: 'Brutal worlds, no clean heroes, real consequences.',
    adult: true,
    tone: 'Bleak, cynical and visceral',
    style: {
      pov: 'Third person limited, several morally compromised point-of-view characters',
      tense: 'Past',
      proseStyle:
        'Gritty, unflinching prose. Violence is graphic and lasting, wounds fester, war is mud and fear. Characters are compromised and make terrible choices for understandable reasons. Black humour in the dialogue; profanity as soldiers really talk.',
      genres: ['grimdark', 'dark-fantasy'],
      genreNotes: '',
      intensity: { romance: 3, violence: 4, language: 4 }
    }
  },
  {
    id: 'noir',
    label: 'Hardboiled noir',
    blurb: 'Rain, corruption, a narrator with a past.',
    adult: true,
    tone: 'Cynical, smoky and fatalistic',
    style: {
      pov: 'First person, the world-weary investigator',
      tense: 'Past',
      proseStyle:
        'Clipped, hard-edged sentences with sharp similes and a sardonic narrator. The city is a character: wet streets, neon, cheap rooms. Everyone lies. Violence is sudden and ugly, sex is a transaction or a trap, and justice is never clean.',
      genres: ['mystery', 'thriller'],
      genreNotes: '',
      intensity: { romance: 3, violence: 3, language: 4 }
    }
  },
  {
    id: 'visceral-horror',
    label: 'Visceral horror',
    blurb: 'Dread that turns graphic. Not for the faint-hearted.',
    adult: true,
    tone: 'Dread-soaked, relentless and grotesque',
    style: {
      pov: 'Close third person',
      tense: 'Past',
      proseStyle:
        'Dread built from ordinary detail going wrong, then horror shown in full: body horror and gore are graphic and specific when they come. Short sentences in the worst moments. No safety: characters the reader loves can die.',
      genres: ['horror'],
      genreNotes: '',
      intensity: { romance: 2, violence: 4, language: 4 }
    }
  },
  {
    id: 'erotic-thriller',
    label: 'Erotic thriller',
    blurb: 'Seduction, secrets and danger tangled together.',
    adult: true,
    tone: 'Sultry, paranoid and gripping',
    style: {
      pov: 'First person, the protagonist drawn into the affair',
      tense: 'Present',
      proseStyle:
        'Taut, sensual prose where desire and suspicion feed each other. Explicit encounters double as power struggles and clues. Short chapters ending on betrayals. Every lover may be the threat.',
      genres: ['thriller', 'erotica'],
      genreNotes: '',
      intensity: { romance: 4, violence: 3, language: 4 }
    }
  },
  {
    id: 'adult-literary',
    label: 'Unflinching literary',
    blurb: 'Adult lives in full: sex, grief, cruelty, tenderness.',
    adult: true,
    tone: 'Frank, intimate and unsparing',
    style: {
      pov: 'Close third person',
      tense: 'Past',
      proseStyle:
        'Precise literary prose that looks directly at adult life: sex on the page when it reveals character, violence and its aftermath shown honestly, language as people really speak. Nothing is there to shock; everything is there because it is true to them.',
      genres: ['literary'],
      genreNotes: '',
      intensity: { romance: 4, violence: 3, language: 4 }
    }
  }
]

export const stylePresetById = (id: string): StylePreset | null => STYLE_PRESETS.find((p) => p.id === id) ?? null

/** The style a preset sets, over a story's (or world's) own: only the parts the preset has. */
export function withPreset<T extends Partial<StyleGuide>>(style: T, preset: StylePreset): T {
  return {
    ...style,
    pov: preset.style.pov,
    tense: preset.style.tense,
    proseStyle: preset.style.proseStyle,
    genres: [...preset.style.genres],
    genreNotes: preset.style.genreNotes,
    intensity: { ...preset.style.intensity }
  }
}

/** The preset a style matches (its genres, levels, point of view, tense and prose style all as the preset sets them), or null. */
export function presetOf(style: Partial<StyleGuide> | null | undefined): StylePreset | null {
  if (!style) return null
  return (
    STYLE_PRESETS.find(
      (p) =>
        style.proseStyle === p.style.proseStyle &&
        style.pov === p.style.pov &&
        style.tense === p.style.tense &&
        JSON.stringify(style.genres ?? []) === JSON.stringify(p.style.genres)
    ) ?? null
  )
}
