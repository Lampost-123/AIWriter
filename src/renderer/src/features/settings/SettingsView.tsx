import type { SettingsTab } from '@/lib/store'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { GlidePill } from '@/components/ui/GlidePill'
import { Archive, BookOpenText, Coins, Cpu, Info, Mic, Palette, PenLine, Trash2, type IconType } from '@/components/ui/icons'
import { useNewLook } from '@/features/look/look'
import { ModelsSettings } from './ModelsSettings'
import { PreferencesSettings } from './PreferencesSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { SpeechSettings } from './SpeechSettings'
import { EditorSettings } from './EditorSettings'
import { BackupsSettings } from './BackupsSettings'
import { RecentlyDeleted } from './RecentlyDeleted'
import { AboutSettings } from './AboutSettings'
import { UsageSettings } from '@/features/usage/UsageSettings'

/** The New look: each page's icon in the list. */
const ICONS: Record<SettingsTab, IconType> = {
  models: Cpu,
  preferences: BookOpenText,
  appearance: Palette,
  speech: Mic,
  editor: PenLine,
  backups: Archive,
  trash: Trash2,
  usage: Coins,
  about: Info
}

const TABS: { id: SettingsTab; label: string; blurb: string }[] = [
  { id: 'models', label: 'Models', blurb: 'Connect OpenRouter or another provider, and pick the model that writes your scenes.' },
  { id: 'preferences', label: 'My writing preferences', blurb: 'Your own defaults, used in every world. Each world can override them.' },
  { id: 'appearance', label: 'Appearance', blurb: 'Theme, accent colour, text size and page width.' },
  {
    id: 'speech',
    label: 'Read aloud and dictation',
    blurb: 'Hear your scenes read aloud, and speak instead of typing. The voices and dictation run on this computer. Your AI model helps with who says what, and a few extras.'
  },
  { id: 'editor', label: 'Editor', blurb: 'Spelling, punctuation as you type, typewriter scrolling and a daily word target.' },
  { id: 'backups', label: 'Backups', blurb: 'Automatic copies of the open world, and restoring one.' },
  {
    id: 'trash',
    label: 'Recently deleted',
    blurb: 'Scenes, chapters and entries deleted from the open world. Each is kept for 30 days, then removed for good.'
  },
  // Milestone 6 (Usage and cost)
  {
    id: 'usage',
    label: 'Usage and cost',
    blurb: 'What the AI has cost across every world in your library, and an optional monthly limit.'
  },
  { id: 'about', label: 'About and updates', blurb: 'Version, library folder and updates.' }
]

export function SettingsView({ tab }: { tab: SettingsTab }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  const isNew = useNewLook()
  return (
    <div className="flex h-full min-h-0">
      {/* The New look: a list with an icon for each page, its chosen row a raised pill that glides. */}
      <nav className="relative w-[200px] shrink-0 border-r border-line bg-surface px-2 py-4 xl:w-[220px] look-new:border-transparent look-new:bg-transparent look-new:px-2.5">
        <h2 className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint look-new:pb-3 look-new:font-heading look-new:text-[19px] look-new:normal-case look-new:tracking-[-0.01em] look-new:text-fg">
          Settings
        </h2>
        <div className="relative look-new:flex look-new:flex-col look-new:gap-0.5">
          {isNew ? <GlidePill /> : null}
          {TABS.map((t) => {
            const Icon = ICONS[t.id]
            const on = t.id === current.id
            return (
              <button
                key={t.id}
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate({ kind: 'settings', tab: t.id })}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors',
                  on ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  'look-new:relative look-new:h-8 look-new:gap-2.5 look-new:rounded-[9px] look-new:py-0',
                  on && 'look-new:bg-transparent'
                )}
              >
                {isNew ? <Icon size={17} selected={on} className={on ? 'text-accent' : 'text-muted'} /> : null}
                <span className="min-w-0 truncate">{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
      {/* The New look: the page itself is a sheet of paper beside the list. */}
      <div className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable] look-new:mr-2 look-new:mt-1 look-new:rounded-t-[14px] look-new:bg-page look-new:shadow-sheet">
        <div className="mx-auto max-w-[760px] px-6 py-8 xl:px-8">
          <h1 className="text-[20px] font-semibold text-fg look-new:text-[30px]">{current.label}</h1>
          <p className="mb-6 mt-1 text-[13px] text-muted">{current.blurb}</p>
          {current.id === 'models' && <ModelsSettings />}
          {current.id === 'preferences' && <PreferencesSettings />}
          {current.id === 'appearance' && <AppearanceSettings />}
          {current.id === 'speech' && <SpeechSettings />}
          {current.id === 'editor' && <EditorSettings />}
          {current.id === 'backups' && <BackupsSettings />}
          {current.id === 'trash' && <RecentlyDeleted />}
          {current.id === 'usage' && <UsageSettings />}
          {current.id === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}
