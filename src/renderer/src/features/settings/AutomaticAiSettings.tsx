// Settings › Models: Automatic AI (the AI overhaul, 2026-10-19), how much the AI does by itself, in one choice. Each
// level sets the planning and checking switches below it (src/shared/automaticAi.ts); changing any of those switches by
// hand makes it Custom. The memory always runs.
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { automaticAiLevel, automaticAiSettings, type AutomaticAiLevel } from '@shared/automaticAi'

const LEVELS: { value: AutomaticAiLevel; label: string; help: string }[] = [
  {
    value: 'off',
    label: 'Off',
    help: 'Only the story’s memory runs by itself. Planning, Check and Critique work whenever you ask.'
  },
  {
    value: 'light',
    label: 'Light',
    help: 'Plans each scene and checks new words and finished scenes. Skips the extra checks after every draft and the read of the whole book before each one.'
  },
  {
    value: 'full',
    label: 'Full',
    help: 'Everything below, every time. The most thorough, and the most expensive.'
  }
]

export function AutomaticAiSettings(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!settings) return null
  const level = automaticAiLevel(settings)
  return (
    <SettingsSection
      title="Automatic AI"
      description="How much the AI does by itself, without being asked. Each choice sets the switches below; change any of them to fine-tune."
    >
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex max-w-md flex-col gap-2">
        <span id={`${id}-label`} className="sr-only">
          Automatic AI
        </span>
        {LEVELS.map((l) => {
          const on = level === l.value
          return (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-describedby={`${id}-${l.value}-help`}
              onClick={() => void update(automaticAiSettings(l.value))}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color] duration-150',
                on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'
              )}
            >
              <span className={cn('text-[13px] font-medium', on ? 'text-accent' : 'text-fg')}>{l.label}</span>
              <span id={`${id}-${l.value}-help`} className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                {l.help}
              </span>
            </button>
          )
        })}
        {level === 'custom' && <p className="text-[12.5px] text-muted">Custom: you’ve set the switches below yourself.</p>}
      </div>
    </SettingsSection>
  )
}
