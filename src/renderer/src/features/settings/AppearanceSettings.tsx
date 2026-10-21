import { useId, useRef, useState } from 'react'
import type { EditorSettings, Settings, ThemeName } from '@shared/types'
import { accentIdOf, arrangementOf, lookOf } from '@shared/contracts/look'
import type { PaintedTheme } from '@shared/api'
import { cn } from '@/lib/cn'
import { Field, Select, SettingsSection, Slider } from '@/components/ui'
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
  // Always the New look now (Classic was retired on 2026-10-19); ClassicAppearance awaits removal.
  const isNew = useNewLook()
  return isNew ? <NewAppearance /> : <ClassicAppearance />
}

type RangeKey = 'fontSize' | 'lineHeight' | 'pageWidth'
type PageLook = Pick<EditorSettings, RangeKey>

const RANGES: { key: RangeKey; label: string; min: number; max: number; step: number; format: (n: number) => string }[] = [
  { key: 'fontSize', label: 'Text size', min: 15, max: 24, step: 1, format: (n) => `${n}px` },
  { key: 'lineHeight', label: 'Line spacing', min: 1.4, max: 2.1, step: 0.05, format: (n) => n.toFixed(2) },
  { key: 'pageWidth', label: 'Page width', min: 55, max: 90, step: 1, format: (n) => `${n} characters` }
]

/**
 * Text size, line spacing and page width. Each moves with the pointer and shows its value (and the preview, through
 * `onLive`) as it moves; the setting is saved once, when it is let go.
 */
function PageSliders({ onLive }: { onLive?: (key: RangeKey, value: number | null) => void }): React.JSX.Element | null {
  const editor = useApp((s) => s.settings?.editor)
  const update = useApp((s) => s.updateSettings)
  if (!editor) return null
  return (
    <>
      {RANGES.map((r) => (
        <Slider
          key={r.key}
          label={r.label}
          format={r.format}
          value={editor[r.key]}
          min={r.min}
          max={r.max}
          step={r.step}
          onLive={onLive ? (v) => onLive(r.key, v) : undefined}
          onCommit={(v) => update({ editor: { [r.key]: v } }).finally(() => onLive?.(r.key, null))}
        />
      ))}
    </>
  )
}

/** Classic: the choices in one column, as they always were. */
function ClassicAppearance(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  return (
    <div className="flex max-w-md flex-col gap-5">
      {/* The New look: the look itself first (the New look or Classic). */}
      <LookPicker />
      <Field label="Theme">{(id) => <Select id={id} value={settings.theme} onChange={(v) => void update({ theme: (v ?? 'system') as ThemeName })} options={THEMES} />}</Field>
      <AccentPicker />
      <PageSliders />
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
 * The New look: the choices in groups (layout, colour, the page, opening), with a small window beside them
 * (AppearancePreview) that changes as they do. In a narrower page the preview comes first, over the choices.
 */
function NewAppearance(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  // What a slider being moved shows in the preview before it is let go (and saved).
  const [live, setLive] = useState<Partial<PageLook>>({})
  if (!settings) return null
  return (
    <div className="@container">
      <div className="grid gap-8 @[940px]:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <aside aria-label="Preview of your choices" className="@[940px]:sticky @[940px]:top-2 @[940px]:order-2 @[940px]:self-start">
          <AppearancePreview
            look={lookOf(settings.look)}
            arrangement={arrangementOf(settings.arrangement)}
            editor={{ ...settings.editor, ...live }}
          />
        </aside>
        <div className="flex min-w-0 flex-col gap-6">
          <SettingsSection title="Layout" description="Where everything sits in the window.">
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
              <PageSliders
                onLive={(key, v) =>
                  setLive((was) => {
                    const next = { ...was }
                    if (v == null) delete next[key]
                    else next[key] = v
                    return next
                  })
                }
              />
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

/**
 * The theme as four small pictures of the window in it; a radio group (the arrow keys move and pick). Each picture is
 * painted by the theme's real colours: it carries the theme, the layout and the accent as the window does
 * (`data-theme`, `data-arrangement`, `data-accent`), so the same token rules in styles.css and desk.css colour it.
 * "Match my computer" is half Light, half Dark.
 */
const FACES: Record<ThemeName, PaintedTheme[]> = { system: ['light', 'dark'], light: ['light'], dark: ['dark'], sepia: ['sepia'] }

function ThemeCards(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (!settings) return null
  const value = settings.theme
  const arrangement = arrangementOf(settings.arrangement)
  const accent = accentIdOf(settings.accent)
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
              <span aria-hidden className="ap-swatch">
                {FACES[t.value].map((face, f) => (
                  <span
                    key={face}
                    className={cn('ap-face', f > 0 && 'is-second')}
                    data-look="new"
                    data-arrangement={arrangement}
                    data-theme={face}
                    data-accent={accent ?? undefined}
                  >
                    <i />
                    <b className="is-title" />
                    <b className="is-line" />
                    <b className="is-link" />
                  </span>
                ))}
              </span>
              <span className="text-[12.5px] font-medium leading-tight text-fg">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
