// Settings › Models: the checks the AI runs by itself (Adam, 2026-10-17: "a way to disable auto checking and auto
// critic checks to save on token costs"). Each is on by default; off, it simply doesn't run, and Check and the Critique
// tab still work whenever he asks. One button turns them all off (or back on), Check new words straight away included.
// The memory keeper isn't here: it keeps the story's memory in step with the words, so it always runs.
import { useId } from 'react'
import { Button, SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'
import type { Settings } from '@shared/types'

type AutoKey = 'checkWhenDone' | 'checkAfterDraft' | 'checkSecondOpinion' | 'chapterCritic'

const ROWS: { key: AutoKey; label: string; help: string }[] = [
  {
    key: 'checkWhenDone',
    label: 'Check a scene when I mark it done',
    help: 'Looks for slips in facts, who knows what, and the timeline. Uses the consistency check model each time.'
  },
  {
    key: 'checkAfterDraft',
    label: 'Check each draft after it lands',
    help: 'Checks the AI’s new words against the story a little after it writes. Uses the consistency check model each time.'
  },
  {
    key: 'checkSecondOpinion',
    label: 'Ask for a second opinion on what checks find',
    help: 'One more call whenever a check finds something, to weed out false alarms. Off, you may see a few more.'
  },
  {
    key: 'chapterCritic',
    label: 'Let the critic read when writing a whole chapter',
    help: 'The critic reads each scene and the chapter, and the AI acts on its notes. Uses the writer model, the dearest one. Off, the chapter is still checked for slips.'
  }
]

/** Every switch the button turns off or on together: this section's, and Check new words straight away. */
const ALL: (AutoKey | 'checkNewWords')[] = ['checkNewWords', ...ROWS.map((r) => r.key)]

export function AutoCheckSettings(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!settings) return null
  const on = (k: keyof Settings): boolean => settings[k] !== false
  const anyOn = ALL.some(on)
  const setAll = (v: boolean): void => void update(Object.fromEntries(ALL.map((k) => [k, v])) as Partial<Settings>)
  return (
    <SettingsSection
      title="Automatic checks"
      description="Checks the AI runs by itself. Turn off any you don't need to save on costs: Check and the Critique tab still work whenever you ask."
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAll(!anyOn)}>
          {anyOn ? 'Turn them all off' : 'Turn them all on'}
        </Button>
      }
    >
      <div className="flex max-w-md flex-col gap-2">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
            <Switch
              id={`${id}-${r.key}`}
              checked={on(r.key)}
              onChange={(v) => void update({ [r.key]: v } as Partial<Settings>)}
              aria-describedby={`${id}-${r.key}-help`}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-${r.key}`} className="text-[13px] font-medium text-fg">
                {r.label}
              </label>
              <p id={`${id}-${r.key}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                {r.help}
              </p>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
