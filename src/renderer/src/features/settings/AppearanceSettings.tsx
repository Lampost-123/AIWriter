import type { ThemeName } from '@shared/types'
import { Field, Select } from '@/components/ui'
import { useApp } from '@/lib/store'

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'system', label: 'Match my computer' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' }
]

export function AppearanceSettings(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  const ed = settings.editor
  const range = (label: string, key: keyof typeof ed, min: number, max: number, step: number, fmt: (n: number) => string): React.JSX.Element => (
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
          className="w-full accent-[var(--accent)]"
        />
      )}
    </Field>
  )
  return (
    <div className="flex max-w-md flex-col gap-5">
      <Field label="Theme">{(id) => <Select id={id} value={settings.theme} onChange={(v) => void update({ theme: (v ?? 'system') as ThemeName })} options={THEMES} />}</Field>
      {range('Text size', 'fontSize', 15, 24, 1, (n) => `${n}px`)}
      {range('Line spacing', 'lineHeight', 1.4, 2.1, 0.05, (n) => n.toFixed(2))}
      {range('Page width', 'pageWidth', 55, 90, 1, (n) => `${n} characters`)}
    </div>
  )
}
