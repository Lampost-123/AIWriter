import type { SettingsTab } from '@/lib/store'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { ModelsSettings } from './ModelsSettings'
import { PreferencesSettings } from './PreferencesSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BackupsSettings } from './BackupsSettings'
import { AboutSettings } from './AboutSettings'

const TABS: { id: SettingsTab; label: string; blurb: string }[] = [
  { id: 'models', label: 'Models', blurb: 'Connect OpenRouter or another provider, and pick the model for each job.' },
  { id: 'preferences', label: 'My writing preferences', blurb: 'Your own defaults, used in every world. Each world can override them.' },
  { id: 'appearance', label: 'Appearance', blurb: 'Theme, text size and page width.' },
  { id: 'backups', label: 'Backups', blurb: 'Automatic copies of the open world, and restoring one.' },
  { id: 'about', label: 'About and updates', blurb: 'Version, library folder and updates.' }
]

export function SettingsView({ tab }: { tab: SettingsTab }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  return (
    <div className="flex h-full min-h-0">
      <nav className="w-[220px] shrink-0 border-r border-line bg-surface px-2 py-4">
        <h2 className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Settings</h2>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate({ kind: 'settings', tab: t.id })}
            className={cn(
              'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors',
              t.id === current.id ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[760px] px-8 py-8">
          <h1 className="text-[20px] font-semibold text-fg">{current.label}</h1>
          <p className="mb-6 mt-1 text-[13px] text-muted">{current.blurb}</p>
          {current.id === 'models' && <ModelsSettings />}
          {current.id === 'preferences' && <PreferencesSettings />}
          {current.id === 'appearance' && <AppearanceSettings />}
          {current.id === 'backups' && <BackupsSettings />}
          {current.id === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}
