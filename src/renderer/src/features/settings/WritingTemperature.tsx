// Settings › Models › Writing temperature (Adam, 2026-10-20): Auto (the creativity's own temperature) or Adam's own,
// for every request that writes the story's words. The memory, checks, planning and the rest keep their own.
// The rule and the ranges live in shared/temperature.ts.
import { useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { CREATIVITY_PRESETS, writerTemperature } from '@shared/defaults'
import {
  DEEPSEEK_STORY_TEMPERATURE,
  WRITING_TEMPERATURE_MAX,
  WRITING_TEMPERATURE_MIN,
  WRITING_TEMPERATURE_STEP,
  cleanWritingTemperature,
  isDeepSeek,
  temperatureCeiling,
  temperatureIgnored
} from '@shared/temperature'
import { Input, Notice, Segmented, SettingsSection, Slider } from '@/components/ui'
import { registerFlusher } from '@/lib/flush'
import { parseTemperature } from './typed'
import { useApp } from '@/lib/store'

type Mode = 'auto' | 'custom'
const MODES: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'custom', label: 'Custom' }
]

const show = (n: number): string => n.toFixed(2).replace(/0$/, '')

/** How long typing must pause before a typed number is saved. */
const TYPING_PAUSE_MS = 700


export function WritingTemperature({ providers }: { providers: ProviderConfig[] }): React.JSX.Element {
  const stored = useApp((s) => s.settings?.writingTemperature)
  const creativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const thinking = useApp((s) => s.settings?.thinking?.writer ?? 'off')
  const update = useApp((s) => s.updateSettings)

  const own = cleanWritingTemperature(stored)
  const mode: Mode = own == null ? 'auto' : 'custom'
  const auto = writerTemperature(creativity)
  const baseUrl = writer ? (providers.find((p) => p.id === writer.providerId)?.baseUrl ?? null) : null
  const modelId = writer?.modelId ?? ''
  const deepSeek = !!writer && isDeepSeek(baseUrl, modelId)
  const ceiling = writer ? temperatureCeiling(baseUrl, modelId) : WRITING_TEMPERATURE_MAX
  const ignored = writer ? temperatureIgnored({ baseUrl, modelId, sampling: writer.sampling }, thinking) : null
  const value = own ?? auto

  // The box holds what is being typed. It is saved after a short pause, on Enter or leaving it, and before the window
  // closes or the page changes, so a number typed is never lost.
  const [typed, setTyped] = useState(show(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setTyped(show(value))
  }, [value])

  const save = (n: number | null): void => void update({ writingTemperature: n == null ? null : cleanWritingTemperature(n) })
  const choose = (m: Mode): void => {
    if (m === 'auto') return save(null)
    // DeepSeek starts where DeepSeek suggests for stories; any other model where Auto had it.
    save(deepSeek ? Math.min(DEEPSEEK_STORY_TEMPERATURE, ceiling) : auto)
  }
  /** Saves what is typed, if it is a number that differs from what is kept. `tidy` also shows it as it was kept. */
  const settle = (tidy: boolean): void => {
    const n = parseTemperature(typed)
    if (n == null) {
      if (tidy) {
        editing.current = false
        setTyped(show(value))
      }
      return
    }
    const kept = cleanWritingTemperature(n)
    if (kept != null && kept !== own) save(kept)
    if (tidy) {
      editing.current = false
      setTyped(show(kept ?? value))
    }
  }
  const settleRef = useRef(settle)
  settleRef.current = settle
  // After a pause in typing; and before closing or switching worlds, and when the page goes (only while typing).
  useEffect(() => {
    if (!editing.current) return
    const t = setTimeout(() => settleRef.current(false), TYPING_PAUSE_MS)
    return () => clearTimeout(t)
  }, [typed])
  useEffect(() => {
    const off = registerFlusher(() => {
      if (editing.current) settleRef.current(false)
    })
    return () => {
      off()
      if (editing.current) settleRef.current(false)
    }
  }, [])

  const custom = mode === 'custom'
  const clamped = custom && own != null && own > ceiling

  return (
    <SettingsSection
      title="Writing temperature"
      description="How much chance the writer model takes with each word as it writes your story: drafts, Continue, Change it and the other AI edits. The memory, checks and planning keep their own settings."
    >
      <div data-testid="writing-temperature" className="flex flex-col gap-3">
        <Segmented label="Writing temperature" value={mode} onChange={choose} options={MODES} className="w-[240px]" />
        <div className="flex max-w-[480px] items-center gap-3">
          <Slider
            aria-label="Temperature"
            min={WRITING_TEMPERATURE_MIN}
            max={WRITING_TEMPERATURE_MAX}
            step={WRITING_TEMPERATURE_STEP}
            value={value}
            disabled={!custom}
            valueText={show}
            onLive={(v) => {
              editing.current = false
              setTyped(show(v))
            }}
            onCommit={(v) => update({ writingTemperature: cleanWritingTemperature(v) })}
            className="min-w-0 flex-1"
          />
          <div className="w-[68px] shrink-0">
            <Input
              aria-label="Temperature number"
              inputMode="decimal"
              value={typed}
              disabled={!custom}
              onChange={(e) => {
                editing.current = true
                setTyped(e.target.value)
              }}
              onBlur={() => settle(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') settle(true)
              }}
              className="text-center tabular-nums"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-faint">
          {custom ? (
            <>
              <p>{deepSeek ? 'DeepSeek suggests about 1.5 for stories. ' : ''}Higher is more surprising, lower is steadier.</p>
              <p>Creativity still shapes which words the writer picks from; this takes the place of its temperature.</p>
            </>
          ) : (
            <>
              <p>Set by the creativity: {show(auto)} for {CREATIVITY_PRESETS[creativity]?.label ?? 'Balanced'}.</p>
              {deepSeek ? <p>DeepSeek suggests about 1.5 for stories. Choose Custom to set it.</p> : null}
            </>
          )}
          {clamped ? <p>Claude models take 0 to 1, so your writer model is sent 1.</p> : null}
        </div>
        {ignored && custom ? <Notice>{ignored}</Notice> : null}
      </div>
    </SettingsSection>
  )
}
