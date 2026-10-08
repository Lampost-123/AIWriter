import { useId, useRef } from 'react'
import type { EditorSettings, Settings, ThemeName } from '@shared/types'
import { arrangementOf, lookOf } from '@shared/contracts/look'
import { Field, Select, SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { AccentPicker } from '@/features/look/AccentPicker'
import { LookPicker } from '@/features/look/LookPicker'
import { useNewLook } from '@/features/look/look'
import { AppearancePreview } from './AppearancePreview'

/** What shows when AI Write opens: the start screen (the default), or straight back to where Adam left off. */
const START_WITH: { value: Settings['startWith']; label: string }[] = [
  { value: 'start', label: 'The start screen' },
  { value: 'last', label: 'Where I left off' }
]

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'system', label: 'Match my computer' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' }
]

const PARAGRAPHS: { value: EditorSettings['paragraphStyle']; label: string; hint: string }[] = [
  { value: 'spaced', label: 'Spaced', hint: 'A gap between paragraphs' },
  { value: 'book', label: 'Book', hint: 'Indented, with no gap, as in a printed book' }
]

export function AppearanceSettings(): React.JSX.Element | null {
  const isNew = useNewLook()
  return isNew ? <NewAppearance /> : <ClassicAppearance />
}

type RangeKey = 'fontSize' | 'lineHeight' | 'pageWidth'

function useRange(): ((label: string, key: RangeKey, min: number, max: number, step: number, fmt: (n: number) => string, styled?: boolean) => React.JSX.Element) | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  const ed = settings.editor
  return (label, key, min, max, step, fmt, styled) => (
    <Field label={`${label}: ${fmt(ed[key])}`}>
      {(id) => (
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={ed[key]}
          onChange={(e) => void update({ editor: { [key]: Number(e.target.value) } })}
          className={styled ? 'st-range' : 'w-full accent-[var(--accent)]'}
          style={styled ? ({ '--fill': `${((ed[key] - min) / (max - min)) * 100}%` } as React.CSSProperties) : undefined}
        />
      )}
    </Field>
  )
}

/** Classic: the choices in one column, as they always were. */
function ClassicAppearance(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const range = useRange()
  if (!settings || !range) return null
  return (
    <div className="flex max-w-md flex-col gap-5">
      {/* The New look: the look itself first (the New look or Classic). */}
      <LookPicker />
      <Field label="Theme">{(id) => <Select id={id} value={settings.theme} onChange={(v) => void update({ theme: (v ?? 'system') as ThemeName })} options={THEMES} />}</Field>
      <AccentPicker />
      {range('Text size', 'fontSize', 15, 24, 1, (n) => `${n}px`)}
      {range('Line spacing', 'lineHeight', 1.4, 2.1, 0.05, (n) => n.toFixed(2))}
      {range('Page width', 'pageWidth', 55, 90, 1, (n) => `${n} characters`)}
      <ParagraphsField />
      <OpensField />
    </div>
  )
}

function ParagraphsField(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  return (
    <Field label="Paragraphs">
      {(id) => (
        <Select
          id={id}
          value={settings.editor.paragraphStyle}
          onChange={(v) => void update({ editor: { paragraphStyle: v === 'book' ? 'book' : 'spaced' } })}
          options={PARAGRAPHS}
        />
      )}
    </Field>
  )
}

function OpensField(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  return (
    <Field label="When AI Write opens" hint="The start screen shows every world and story, with where you left off at the top.">
      {(id) => (
        <Select
          id={id}
          value={settings.startWith === 'last' ? 'last' : 'start'}
          onChange={(v) => void update({ startWith: v === 'last' ? 'last' : 'start' })}
          options={START_WITH}
        />
      )}
    </Field>
  )
}

/**
 * The New look: the choices in groups (style and layout, colour, the page, opening), with a small window beside them
 * (AppearancePreview) that changes as they do. In a narrower page the preview comes first, over the choices.
 */
function NewAppearance(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const range = useRange()
  if (!settings || !range) return null
  return (
    <div className="@container">
      <div className="grid gap-8 @[940px]:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <aside aria-label="Preview of your choices" className="@[940px]:sticky @[940px]:top-2 @[940px]:order-2 @[940px]:self-start">
          <AppearancePreview look={lookOf(settings.look)} arrangement={arrangementOf(settings.arrangement)} editor={settings.editor} />
        </aside>
        <div className="flex min-w-0 flex-col gap-6">
          <SettingsSection title="Style and layout" description="How the whole window looks, and where everything sits.">
            <div className="flex flex-col gap-4">
              <LookPicker />
            </div>
          </SettingsSection>
          <SettingsSection title="Colour" description="The theme for the whole window, and the colour for buttons, links and what’s selected.">
            <div className="flex flex-col gap-5">
              <ThemeCards />
              <AccentPicker />
            </div>
          </SettingsSection>
          <SettingsSection title="The page" description="How your story reads as you write it. The preview shows your own choices.">
            <div className="grid gap-x-8 gap-y-4 @[620px]:grid-cols-2">
              {range('Text size', 'fontSize', 15, 24, 1, (n) => `${n}px`, true)}
              {range('Line spacing', 'lineHeight', 1.4, 2.1, 0.05, (n) => n.toFixed(2), true)}
              {range('Page width', 'pageWidth', 55, 90, 1, (n) => `${n} characters`, true)}
              <ParagraphsField />
            </div>
          </SettingsSection>
          <SettingsSection title="Opening" description="What you see first each time.">
            <div className="max-w-[360px]">
              <OpensField />
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

/** The theme as four small pictures of the window in it; a radio group (the arrow keys move and pick). */
const THEME_LOOKS: Record<ThemeName, { frame: string; page: string; ink: string; line: string; split?: true }> = {
  system: { frame: '#d8dee7', page: '#fafbfc', ink: '#1b2130', line: '#c2cad6', split: true },
  light: { frame: '#d8dee7', page: '#fafbfc', ink: '#1b2130', line: '#c2cad6' },
  dark: { frame: '#0d1220', page: '#182033', ink: '#e8ecf4', line: '#3a4663' },
  sepia: { frame: '#e5d9c0', page: '#faf4e5', ink: '#3b2f22', line: '#d5c4a1' }
}

function ThemeCards(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (!settings) return null
  const value = settings.theme
  const index = Math.max(0, THEMES.findIndex((t) => t.value === value))
  const pick = (t: ThemeName): void => void update({ theme: t })
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[12px] font-medium text-muted">
        Theme
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="ap-theme"
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
          if (!step) return
          e.preventDefault()
          const next = (index + step + THEMES.length) % THEMES.length
          pick(THEMES[next].value)
          refs.current[next]?.focus()
        }}
      >
        {THEMES.map((t, i) => {
          const c = THEME_LOOKS[t.value]
          const dark = THEME_LOOKS.dark
          const on = t.value === value
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.value)}
            >
              <span
                aria-hidden
                className="ap-swatch"
                style={{ background: c.split ? `linear-gradient(115deg, ${c.frame} 50%, ${dark.frame} 50%)` : c.frame }}
              >
                <i style={{ background: c.split ? `linear-gradient(115deg, ${c.page} 44%, ${dark.page} 44%)` : c.page }} />
                <b style={{ top: 17, width: '34%', background: c.ink, opacity: 0.75 }} />
                <b style={{ top: 25, width: '46%', background: c.line }} />
                <b style={{ top: 31, width: '40%', background: c.line }} />
              </span>
              <span className="text-[12.5px] font-medium leading-tight text-fg">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
