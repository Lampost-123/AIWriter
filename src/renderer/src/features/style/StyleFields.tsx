import { memo, useId, type ReactNode } from 'react'
import type { EffectiveStyle, StyleTextKey } from '@shared/style'
import type { Spelling, StyleGuide } from '@shared/types'
import { Field, Select } from '@/components/ui'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { ChipListInput } from '@/features/world/parts/ChipListInput'
import { POV_PRESETS, PresetInput, TENSE_PRESETS } from '@/features/world/parts/TextInputs'

/** Shortens a long value for a placeholder or a hint line. */
export const short = (s: string, max = 120): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

const TEXT: Record<Exclude<StyleTextKey, 'pov' | 'tense'>, { label: string; placeholder: string; hint?: string; rows: number }> = {
  proseStyle: {
    label: 'Prose style',
    placeholder: 'Plain and spare. Short paragraphs. Concrete detail over adjectives.',
    rows: 3
  },
  samplePassage: {
    label: 'Sample passage',
    placeholder: 'Paste a few paragraphs written the way you want every scene to sound.',
    hint: 'One passage in the voice you want. The AI copies its rhythm, not its events.',
    rows: 7
  },
  contentLimits: {
    label: 'Content limits',
    placeholder: 'No graphic violence on the page. Fade to black for love scenes.',
    rows: 2
  },
  notes: {
    label: 'Notes',
    placeholder: 'Anything else about how the writing should read',
    rows: 2
  }
}

const SPELLING_OPTIONS = [
  { value: 'UK', label: 'UK spelling', hint: 'colour, realise' },
  { value: 'US', label: 'US spelling', hint: 'color, realize' }
]

/**
 * The style guide fields, used for the world (with Adam's preferences underneath)
 * and for a story (with the world's guide and Adam's preferences underneath).
 * `below` is the style the levels underneath give, so empty fields can show what
 * applies instead.
 */
export const StyleFields = memo(function StyleFields({
  value,
  onChange,
  below,
  prefsPhrases,
  mode
}: {
  value: StyleGuide
  onChange: (patch: Partial<StyleGuide>) => void
  below: EffectiveStyle
  /** Adam's own words to avoid, to say where inherited phrases come from. */
  prefsPhrases: string[]
  mode: 'world' | 'story'
}): React.JSX.Element {
  /** What applies when this field is left empty, in words. */
  const inherited = (key: keyof StyleGuide, text: string): string | null => {
    const src = below.sources[key]
    if (src === 'none' || !text) return null
    if (mode === 'world') return src === 'prefs' ? `From my preferences: ${text}` : null
    return src === 'world' ? `Uses the world's: ${text}` : `Uses my preferences: ${text}`
  }

  // World: an empty field shows the preference in effect underneath. Story: as a placeholder.
  const textProps = (key: StyleTextKey, fallback: string): { placeholder: string; hint: ReactNode } => {
    const set = !!value[key].trim()
    const from = set ? null : inherited(key, short(below[key]))
    if (mode === 'story') return { placeholder: from ?? fallback, hint: null }
    // Once the world sets its own value, the line stays and says what it replaces,
    // so typing the first letter doesn't make the fields below jump.
    const replaces = set && below.sources[key] === 'prefs' && below[key] ? `Instead of my preference: ${short(below[key])}` : null
    const line = from ?? replaces
    return { placeholder: fallback, hint: line ? <span className="italic">{line}</span> : null }
  }

  const spellingFallback =
    below.sources.spelling === 'none'
      ? 'Not set'
      : mode === 'world' || below.sources.spelling === 'prefs'
        ? `Use my preference (${below.spelling})`
        : `Use the world's (${below.spelling})`

  // Phrases to avoid add up across levels, so show the ones coming from underneath.
  const belowPhrases = below.avoidPhrases
  const worldAdds = mode === 'story' && below.sources.avoidPhrases === 'world'
  const phrasesFrom = !worldAdds
    ? 'Also avoided, from my preferences'
    : prefsPhrases.some((p) => p.trim())
      ? "Also avoided, from the world's guide and my preferences"
      : "Also avoided, from the world's guide"

  const pov = textProps('pov', 'Close third person')
  const tense = textProps('tense', 'Past tense')
  const ids = { phrases: useId(), phrasesHint: useId() }

  return (
    <div className="flex flex-col gap-8">
      <Group title="Voice">
        <Field label="Point of view" hint={pov.hint}>
          {(id) => <PresetInput id={id} value={value.pov} presets={POV_PRESETS} placeholder={pov.placeholder} onChange={(v) => onChange({ pov: v })} />}
        </Field>
        <Field label="Tense" hint={tense.hint}>
          {(id) => <PresetInput id={id} value={value.tense} presets={TENSE_PRESETS} placeholder={tense.placeholder} onChange={(v) => onChange({ tense: v })} />}
        </Field>
        <Field label="Spelling">
          {(id) => (
            <Select
              id={id}
              value={value.spelling || null}
              onChange={(v) => onChange({ spelling: (v ?? '') as Spelling | '' })}
              options={SPELLING_OPTIONS}
              allowNone
              noneLabel={spellingFallback}
              className="max-w-[320px]"
            />
          )}
        </Field>
      </Group>

      <Group title="Prose">
        {(['proseStyle', 'samplePassage'] as const).map((key) => {
          const def = TEXT[key]
          const p = textProps(key, def.placeholder)
          return (
            <Field key={key} label={def.label} hint={p.hint ?? def.hint}>
              {(id) => (
                <AutoTextarea
                  id={id}
                  value={value[key]}
                  minRows={def.rows}
                  maxRows={key === 'samplePassage' ? 28 : 12}
                  placeholder={p.placeholder}
                  onChange={(e) => onChange({ [key]: e.target.value })}
                  className={key === 'samplePassage' ? 'font-serif text-[15px]! leading-[1.65]!' : undefined}
                />
              )}
            </Field>
          )
        })}
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.phrases} className="text-[12px] font-medium text-muted">
            Phrases to avoid
          </label>
          <ChipListInput
            id={ids.phrases}
            aria-describedby={ids.phrasesHint}
            value={value.avoidPhrases}
            onChange={(avoidPhrases) => onChange({ avoidPhrases })}
            placeholder="Type a phrase and press Enter"
          />
          <p id={ids.phrasesHint} className="text-[12px] text-faint">
            {belowPhrases.length ? (
              <span className="italic">
                {phrasesFrom}: {short(belowPhrases.join(', '), 200)}
              </span>
            ) : (
              'Words and phrases the AI should never use, like "suddenly" or "a shiver ran down her spine".'
            )}
          </p>
        </div>
      </Group>

      <Group title="Limits and notes">
        {(['contentLimits', 'notes'] as const).map((key) => {
          const def = TEXT[key]
          const p = textProps(key, def.placeholder)
          return (
            <Field key={key} label={def.label} hint={p.hint ?? def.hint}>
              {(id) => (
                <AutoTextarea id={id} value={value[key]} minRows={def.rows} maxRows={12} placeholder={p.placeholder} onChange={(e) => onChange({ [key]: e.target.value })} />
              )}
            </Field>
          )
        })}
      </Group>
    </div>
  )
})

/** A titled group of fields, set off from the one above by a rule. */
export function Group({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  )
}
