// Kind-specific fields for world bible entries. The forms and the context
// assembly both read these lists, so a field added here shows up in both.

import type { EntryKind } from './types'

export interface FieldDef {
  key: string
  label: string
  /** 'line' = single line input, 'text' = multi-line. */
  type: 'line' | 'text'
  placeholder?: string
  /** Left out of the short form of a profile when the briefing is tight. */
  optionalInShort?: boolean
}

export interface FieldGroup {
  id: string
  label: string
  fields: FieldDef[]
}

export const CHARACTER_ROLES = ['protagonist', 'antagonist', 'supporting', 'minor'] as const

export const CHARACTER_GROUPS: FieldGroup[] = [
  {
    id: 'basics',
    label: 'Basics',
    fields: [
      { key: 'pronouns', label: 'Pronouns', type: 'line', placeholder: 'she/her' },
      { key: 'age', label: 'Age or birth date', type: 'line', placeholder: '34' },
      { key: 'role', label: 'Role in the story', type: 'line', placeholder: 'protagonist, antagonist, supporting or minor' }
    ]
  },
  {
    id: 'looks',
    label: 'Looks',
    fields: [
      { key: 'build', label: 'Build', type: 'line' },
      { key: 'face', label: 'Face', type: 'line' },
      { key: 'hair', label: 'Hair', type: 'line' },
      { key: 'eyes', label: 'Eyes', type: 'line' },
      { key: 'skin', label: 'Skin', type: 'line' },
      { key: 'marks', label: 'Distinguishing marks', type: 'line', placeholder: 'Scar through the left eyebrow' },
      { key: 'clothing', label: 'Typical clothing', type: 'line' },
      { key: 'movement', label: 'How they move', type: 'line' }
    ]
  },
  {
    id: 'personality',
    label: 'Personality',
    fields: [
      { key: 'traits', label: 'Core traits', type: 'text' },
      { key: 'values', label: 'Values', type: 'text' },
      { key: 'flaws', label: 'Flaws', type: 'text' },
      { key: 'fears', label: 'Fears', type: 'text' },
      { key: 'desires', label: 'Desires', type: 'text' },
      { key: 'habits', label: 'Habits and quirks', type: 'text' },
      { key: 'triggers', label: 'What makes them laugh or snap', type: 'text' }
    ]
  },
  {
    id: 'backstory',
    label: 'Backstory',
    fields: [
      { key: 'origin', label: 'Origin', type: 'text', optionalInShort: true },
      { key: 'pastEvents', label: 'Key past events', type: 'text', optionalInShort: true },
      { key: 'secrets', label: 'Secrets they keep', type: 'text', optionalInShort: true }
    ]
  },
  {
    id: 'arc',
    label: 'Goals and arc',
    fields: [
      { key: 'wants', label: 'What they want', type: 'text' },
      { key: 'needs', label: 'What they actually need', type: 'text' },
      { key: 'arcStart', label: 'Where the arc starts', type: 'text', optionalInShort: true },
      { key: 'arcEnd', label: 'Where the arc should end', type: 'text', optionalInShort: true },
      { key: 'motivation', label: 'Current motivation', type: 'text' }
    ]
  },
  {
    id: 'voice',
    label: 'Voice',
    fields: [
      { key: 'speech', label: 'How they speak', type: 'text', placeholder: 'Sentence length, vocabulary, dialect' },
      { key: 'tics', label: 'Verbal tics', type: 'text' },
      { key: 'neverSays', label: 'What they never say', type: 'text' },
      { key: 'sampleLines', label: 'Sample lines of dialogue', type: 'text', placeholder: 'One line per row, 3 to 5 lines' }
    ]
  }
]

export const PLACE_GROUPS: FieldGroup[] = [
  {
    id: 'place',
    label: 'Place',
    fields: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'text' },
      { key: 'senses', label: 'Sights, sounds and smells', type: 'text' },
      { key: 'geography', label: 'Geography', type: 'text', optionalInShort: true },
      { key: 'people', label: 'Who rules or lives there', type: 'text' },
      { key: 'history', label: 'History', type: 'text', optionalInShort: true }
    ]
  }
]

export const LORE_GROUPS: FieldGroup[] = [
  {
    id: 'lore',
    label: 'Lore',
    fields: [
      { key: 'category', label: 'Category', type: 'line', placeholder: 'Magic, history, religion, custom, law' },
      { key: 'rules', label: 'How it works', type: 'text' },
      { key: 'limits', label: 'Limits and costs', type: 'text' }
    ]
  }
]

export const GROUP_GROUPS: FieldGroup[] = [
  {
    id: 'group',
    label: 'Group',
    fields: [
      { key: 'category', label: 'What kind of group', type: 'line', placeholder: 'Family, guild, faction, order, nation' },
      { key: 'goals', label: 'Goals', type: 'text', placeholder: 'What they want, and what they will do to get it' },
      { key: 'ranks', label: 'Ranks and titles', type: 'text', placeholder: 'Who leads, who follows, and what they are called' },
      { key: 'rivals', label: 'Rivals and allies', type: 'text' },
      { key: 'customs', label: 'Symbols and customs', type: 'text', optionalInShort: true },
      { key: 'history', label: 'History', type: 'text', optionalInShort: true }
    ]
  }
]

export const ITEM_GROUPS: FieldGroup[] = [
  {
    id: 'item',
    label: 'Item',
    fields: [
      { key: 'category', label: 'What kind of item', type: 'line', placeholder: 'Weapon, heirloom, letter, key' },
      { key: 'powers', label: 'Powers or uses', type: 'text' },
      { key: 'limits', label: 'Limits and costs', type: 'text' },
      { key: 'origin', label: 'Where it came from', type: 'text', optionalInShort: true }
    ]
  }
]

export const EVENT_GROUPS: FieldGroup[] = [
  {
    id: 'event',
    label: 'Event',
    fields: [
      { key: 'when', label: 'When it happened', type: 'line', placeholder: "Day 12, Year 3, or 'the winter before the war'" },
      { key: 'happened', label: 'What happened', type: 'text' },
      { key: 'aftermath', label: 'What came of it', type: 'text' },
      { key: 'remembered', label: 'How people remember it', type: 'text', optionalInShort: true }
    ]
  }
]

export const THREAD_GROUPS: FieldGroup[] = [
  {
    id: 'thread',
    label: 'Plot thread',
    fields: [
      {
        key: 'promise',
        label: "What's promised to the reader",
        type: 'text',
        placeholder: 'The question the reader is waiting to see answered'
      },
      { key: 'clues', label: 'Clues given so far', type: 'text', optionalInShort: true },
      { key: 'payoff', label: 'How it should pay off', type: 'text', optionalInShort: true }
    ]
  }
]

export const GLOSSARY_GROUPS: FieldGroup[] = [
  {
    id: 'glossary',
    label: 'Term',
    fields: [
      { key: 'pronunciation', label: 'How to say it', type: 'line', placeholder: 'KEL-oh-ran' },
      {
        key: 'spelling',
        label: 'Notes on spelling',
        type: 'text',
        placeholder: "Always capitalised. The plural is Kel'oran, never Kel'orans."
      },
      { key: 'usage', label: 'Who uses it, and when', type: 'text', optionalInShort: true }
    ]
  }
]

export const FIELD_GROUPS: Partial<Record<EntryKind, FieldGroup[]>> = {
  character: CHARACTER_GROUPS,
  place: PLACE_GROUPS,
  group: GROUP_GROUPS,
  item: ITEM_GROUPS,
  lore: LORE_GROUPS,
  event: EVENT_GROUPS,
  thread: THREAD_GROUPS,
  glossary: GLOSSARY_GROUPS
}

export const KIND_LABELS: Record<EntryKind, { one: string; many: string }> = {
  character: { one: 'Character', many: 'Characters' },
  place: { one: 'Place', many: 'Places' },
  group: { one: 'Group', many: 'Groups' },
  item: { one: 'Item', many: 'Items' },
  lore: { one: 'Lore', many: 'Lore' },
  event: { one: 'Event', many: 'Events' },
  thread: { one: 'Plot thread', many: 'Plot threads' },
  glossary: { one: 'Term', many: 'Glossary' }
}

/** Kinds that have screens in milestone 1. */
export const M1_KINDS: EntryKind[] = ['character', 'place', 'lore']

/** Every kind, in the order the world's lists show them (milestone 2 on). */
export const ENTRY_KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event', 'thread', 'glossary']
