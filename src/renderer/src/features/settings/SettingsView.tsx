import { useEffect, useRef, useState } from 'react'
import type { SettingsTab } from '@/lib/store'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { GlidePill } from '@/components/ui/GlidePill'
import { Archive, BookOpenText, Coins, Cpu, Info, Mic, Palette, PenLine, Search, Trash2, X, type IconType } from '@/components/ui/icons'
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
import { SectionArt } from './art/SectionArt'
import { SETTINGS_GROUPS, SETTINGS_PAGES, findSettings, groupOf } from './settingsIndex'
import './settings.css'

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

/** The page itself. */
function Page({ tab }: { tab: SettingsTab }): React.JSX.Element {
  return (
    <>
      {tab === 'models' && <ModelsSettings />}
      {tab === 'preferences' && <PreferencesSettings />}
      {tab === 'appearance' && <AppearanceSettings />}
      {tab === 'speech' && <SpeechSettings />}
      {tab === 'editor' && <EditorSettings />}
      {tab === 'backups' && <BackupsSettings />}
      {tab === 'trash' && <RecentlyDeleted />}
      {tab === 'usage' && <UsageSettings />}
      {tab === 'about' && <AboutSettings />}
    </>
  )
}

export function SettingsView({ tab }: { tab: SettingsTab }): React.JSX.Element {
  const isNew = useNewLook()
  return isNew ? <NewSettings tab={tab} /> : <ClassicSettings tab={tab} />
}

/** Classic: the list of pages and the page, exactly as they always were. */
function ClassicSettings({ tab }: { tab: SettingsTab }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  return (
    <div className="flex h-full min-h-0">
      <nav className="relative w-[200px] shrink-0 border-r border-line bg-surface px-2 py-4 xl:w-[220px]">
        <h2 className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Settings</h2>
        <div className="relative">
          {TABS.map((t) => {
            const on = t.id === current.id
            return (
              <button
                key={t.id}
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate({ kind: 'settings', tab: t.id })}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors',
                  on ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                <span className="min-w-0 truncate" title={t.label}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-[760px] px-6 py-8 xl:px-8">
          <h1 className="text-[20px] font-semibold text-fg">{current.label}</h1>
          <p className="mb-6 mt-1 text-[13px] text-muted">{current.blurb}</p>
          <Page tab={current.id} />
        </div>
      </div>
    </div>
  )
}

/** How wide a page's column may grow in a big window (charts and lists use the room; forms stay readable). */
const WIDE: Partial<Record<SettingsTab, string>> = {
  models: 'max-w-[1160px]',
  usage: 'max-w-[1160px]',
  backups: 'max-w-[1160px]',
  trash: 'max-w-[1040px]',
  appearance: 'max-w-[1160px]',
  about: 'max-w-[980px]'
}

/**
 * The New look (the panels and the desk): the pages grouped down the side, each with its icon, under "Find a setting";
 * the page beside them with its small picture, its group in small capitals, its name and one line about it.
 */
function NewSettings({ tab }: { tab: SettingsTab }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const current = SETTINGS_PAGES.find((t) => t.id === tab) ?? SETTINGS_PAGES[0]
  const scroller = useRef<HTMLDivElement>(null)
  // A new page starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [current.id])
  return (
    <div className="st flex h-full min-h-0" data-settings-page={current.id}>
      <SettingsNav current={current.id} onPick={(id) => navigate({ kind: 'settings', tab: id })} />
      <div ref={scroller} className="st-page min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div className={cn('mx-auto px-8 pb-16 pt-9 xl:px-12', WIDE[current.id] ?? 'max-w-[840px]')}>
          <header key={current.id} className="st-head mb-8 flex items-center gap-6">
            <div className="st-head-art shrink-0">
              <SectionArt tab={current.id} className="h-[88px] w-[121px]" />
            </div>
            <div className="min-w-0">
              <p className="st-caps">{groupOf(current.id)}</p>
              <h1 className="st-title">{current.label}</h1>
              <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-relaxed text-muted">{current.blurb}</p>
            </div>
          </header>
          <Page tab={current.id} />
        </div>
      </div>
    </div>
  )
}

/** The list of pages: "Find a setting", then the groups with their pages. The chosen page's pill glides. */
function SettingsNav({ current, onPick }: { current: SettingsTab; onPick: (id: SettingsTab) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const found = query.trim() ? findSettings(query) : null
  const input = useRef<HTMLInputElement>(null)
  const pick = (id: SettingsTab): void => {
    setQuery('')
    onPick(id)
  }
  return (
    <nav aria-label="Settings" className="st-nav relative flex w-[248px] shrink-0 flex-col xl:w-[268px]">
      <h2 className="st-nav-title">Settings</h2>
      <div className="st-find relative mx-3 mb-3">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={input}
          type="text"
          aria-label="Find a setting"
          placeholder="Find a setting"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
            if (e.key === 'Enter' && found?.length) pick(found[0].page.id)
          }}
          className="h-8 w-full rounded-[9px] pl-8 pr-7 text-[13px] text-fg outline-none placeholder:text-faint"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setQuery('')
              input.current?.focus()
            }}
            className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-surface-2 hover:text-fg"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <GlidePill className="st-pill" />
        {found ? (
          found.length ? (
            <div role="group" aria-label="Found" className="flex flex-col gap-0.5">
              {found.map((m) => (
                <NavRow key={m.page.id} id={m.page.id} label={m.page.label} hint={m.hit} on={m.page.id === current} onPick={pick} />
              ))}
            </div>
          ) : (
            <p className="px-2.5 py-2 text-[12.5px] leading-relaxed text-faint">Nothing in Settings by that name. Try a shorter word.</p>
          )
        ) : (
          SETTINGS_GROUPS.map((g) => (
            <div key={g.label} role="group" aria-label={g.label} className="mb-3">
              <p aria-hidden className="st-group">
                {g.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {g.pages.map((p) => (
                  <NavRow key={p.id} id={p.id} label={p.label} on={p.id === current} onPick={pick} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </nav>
  )
}

function NavRow({ id, label, hint, on, onPick }: { id: SettingsTab; label: string; hint?: string | null; on: boolean; onPick: (id: SettingsTab) => void }): React.JSX.Element {
  const Icon = ICONS[id]
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={() => onPick(id)}
      className={cn('st-row relative z-[1] flex w-full items-center gap-2.5 rounded-[10px] px-2 text-left', hint ? 'min-h-11 py-1.5' : 'h-9', on && 'is-on')}
    >
      <span className="st-row-icon grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]">
        <Icon size={15} selected={on} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px]" title={label}>
          {label}
        </span>
        {hint ? <span className="block truncate text-[11.5px] text-faint">{hint}</span> : null}
      </span>
    </button>
  )
}
