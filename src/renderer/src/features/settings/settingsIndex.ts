// Settings' pages in the New look: their groups in the list, their words, and what "Find a setting" finds on each.
// Pure, so it is unit-tested (settingsIndex.test.ts).
import type { SettingsTab } from '@/lib/store'

export interface SettingsPage {
  id: SettingsTab
  label: string
  /** The one line under the page's heading. */
  blurb: string
  /** What the page holds, in Adam's words: "Find a setting" matches these. */
  finds: string[]
}

export interface SettingsGroup {
  label: string
  pages: SettingsPage[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Writing',
    pages: [
      {
        id: 'models',
        label: 'Models',
        blurb: 'Connect OpenRouter or another service, and pick the model that writes your scenes.',
        finds: [
          'OpenRouter',
          'API key',
          'Provider',
          'Writer model',
          'Memory model',
          'Character builder model',
          'World builder model',
          'Chat and brainstorm model',
          'Consistency check model',
          'Creativity',
          'Thinking',
          'Plan before writing',
          'Check and repair',
          'Find by meaning',
          'LM Studio',
          'Ollama',
          'DeepSeek'
        ]
      },
      {
        id: 'preferences',
        label: 'My writing preferences',
        blurb: 'Your own defaults, used in every world. Each world can change them.',
        finds: ['Point of view', 'Tense', 'Spelling', 'UK or US', 'How the prose should sound', 'Style', 'Genre', 'Writing style']
      },
      {
        id: 'editor',
        label: 'Editor',
        blurb: 'Spelling, punctuation as you type, typewriter scrolling and a daily word target.',
        finds: ['Spell check', 'Smart quotes', 'Smart punctuation', 'Typewriter scrolling', 'Daily word target', 'Word goal', 'Show beats', 'Beat markers']
      },
      {
        id: 'speech',
        label: 'Read aloud and dictation',
        blurb: 'Hear your scenes read aloud, and speak instead of typing. Voices and dictation run on this computer.',
        finds: ['Read aloud', 'Voice', 'Narrator', 'Reading speed', 'Cast', 'Character voices', 'Dictation', 'Dictation key', 'Microphone', 'Sound effects', 'Emotion and tone', 'Speech engine']
      }
    ]
  },
  {
    label: 'Look and feel',
    pages: [
      {
        id: 'appearance',
        label: 'Appearance',
        blurb: 'Style and layout, theme, accent colour, and how the page reads.',
        finds: ['Theme', 'Dark', 'Light', 'Sepia', 'New look', 'Classic', 'Layout', 'Desk', 'Panels', 'Accent colour', 'Text size', 'Font size', 'Line spacing', 'Page width', 'Paragraphs', 'When AI Write opens', 'Start screen']
      }
    ]
  },
  {
    label: 'Your work',
    pages: [
      {
        id: 'backups',
        label: 'Backups',
        blurb: 'Automatic copies of the open world, and going back to one.',
        finds: ['Back up now', 'Restore', 'Second backup folder', 'Dropbox', 'OneDrive', 'iCloud']
      },
      {
        id: 'trash',
        label: 'Recently deleted',
        blurb: 'Scenes, chapters and entries deleted from the open world, kept for 30 days.',
        finds: ['Trash', 'Bring back', 'Undo delete', 'Deleted scenes', 'Deleted entries']
      },
      {
        id: 'usage',
        label: 'Usage and cost',
        blurb: 'What the AI has cost across every world in your library, and an optional monthly limit.',
        finds: ['Spending', 'Monthly limit', 'Cost', 'Tokens', 'By model', 'By world', 'By job', 'Dollars']
      }
    ]
  },
  {
    label: 'AI Write',
    pages: [
      {
        id: 'about',
        label: 'About and updates',
        blurb: 'Which version this is, what’s new, and updates.',
        finds: ['Version', 'Updates', 'Check for updates', 'What’s new', 'Library folder', 'Release notes', 'Phone', 'On your phone', 'Pairing code']
      }
    ]
  }
]

export const SETTINGS_PAGES: SettingsPage[] = SETTINGS_GROUPS.flatMap((g) => g.pages)

export const groupOf = (tab: SettingsTab): string => SETTINGS_GROUPS.find((g) => g.pages.some((p) => p.id === tab))?.label ?? ''

/** A match for "Find a setting": the page, and the thing on it that matched (null when its name did). */
export interface SettingsMatch {
  page: SettingsPage
  hit: string | null
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The pages that hold what Adam typed: its name first, then what is on it; every word typed must be found. */
export function findSettings(query: string): SettingsMatch[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const has = (text: string): boolean => {
    const t = ` ${norm(text)}`
    return words.every((w) => t.includes(` ${w}`))
  }
  const out: SettingsMatch[] = []
  for (const page of SETTINGS_PAGES) {
    if (has(page.label)) out.push({ page, hit: null })
    else {
      const hit = page.finds.find(has)
      if (hit) out.push({ page, hit })
    }
  }
  // Names first.
  return out.sort((a, b) => Number(a.hit !== null) - Number(b.hit !== null))
}
