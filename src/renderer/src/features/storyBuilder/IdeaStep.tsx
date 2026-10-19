// The Story builder's first step: the idea. On the left, what Adam writes: his plot (as long as he likes), where it is
// set, what must and must never happen, how long it is, his own characters and places, and the AI's questions. On the
// right, the story's style (one place for everything the AI writes in this story: a preset, how far it goes, point
// of view, tense and tone) and the recipe it follows, if any, which can be talked over or redone for this story.

import { useEffect, useId, useState } from 'react'
import { CircleHelp, CookingPot, Plus, Settings2, Square, Trash2, X } from '@/components/ui/icons'
import type { BriefEntry, StoryLength } from '@shared/contracts/storyBuilder'
import type { RecipePartId, RecipeSummary } from '@shared/contracts/recipes'
import { RECIPE_PARTS } from '@shared/contracts/recipes'
import type { EntryKind, ID, StyleGuide } from '@shared/types'
import { withPreset, type StylePreset } from '@shared/stylePresets'
import { effectiveStyle } from '@shared/style'
import { Button, Field, Input, Notice, Select, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from '@/features/planning/LampThinking'
import { StylePresets } from '@/features/style/StylePresets'
import { IntensityControls } from '@/features/style/IntensityControls'
import { usePrefs } from '@/features/style/prefsStore'
import { editStoryStyle } from '@/features/stories/storyActions'
import { PART_LABELS, PartRedo, RecipeTalkPanel, talkParts } from '@/features/recipes/RecipeTalk'
import { settlePreview } from '@/features/planning/talkStore'
import {
  answerQuestion,
  applyRecipeTalk,
  askQuestion,
  builderKey,
  dropRecipe,
  partsInUse,
  patchBrief,
  pickRecipe,
  recipeScope,
  removeAnswer,
  saveRecipeBack,
  setRecipePart,
  sizeForLength,
  stopQuestion,
  useBuilders
} from './store'

// "Not sure yet" (2026-10-19: it was "Let the AI choose", but nothing chose: the outline just started at its usual
// size). The hint under it says what each one lays out.
const LENGTHS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Not sure yet' },
  { value: 'short', label: 'A short story' },
  { value: 'novella', label: 'A novella' },
  { value: 'novel', label: 'A full novel' }
]

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'character', label: 'Character' },
  { value: 'place', label: 'Place' },
  { value: 'group', label: 'Group' },
  { value: 'item', label: 'Item' },
  { value: 'lore', label: 'Lore' },
  { value: 'event', label: 'Event' }
]

export function IdeaStep({ storyId }: { storyId: ID }): React.JSX.Element {
  const brief = useBuilders((s) => s.builders[builderKey(storyId)]?.brief)!
  const plotId = useId()
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor={plotId} className="text-[13px] font-semibold text-fg">
            Your plot
          </label>
          <p className="mt-0.5 text-[12.5px] text-muted">As much or as little as you have: a few lines, or the whole story beat by beat. Everything you write here wins.</p>
          <AutoTextarea
            id={plotId}
            value={brief.plot}
            minRows={8}
            maxRows={40}
            placeholder="A lighthouse keeper’s daughter has one winter to prove the town still needs its light, while someone is wrecking ships on purpose…"
            className="mt-2 font-serif text-[15px] leading-[1.65] placeholder:font-sans placeholder:text-[13.5px]"
            onChange={(e) => patchBrief(storyId, { plot: e.target.value })}
            data-plot
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Where and when it is set">
            {(id) => (
              <AutoTextarea id={id} value={brief.setting} minRows={2} maxRows={8} placeholder="A cold northern harbour town, 1890s" onChange={(e) => patchBrief(storyId, { setting: e.target.value })} />
            )}
          </Field>
          <Field label="How long" hint={lengthHint(brief.length)}>
            {(id) => (
              <Select
                id={id}
                value={brief.length || 'auto'}
                options={LENGTHS}
                onChange={(v) => patchBrief(storyId, { length: (v === 'auto' || !v ? '' : v) as StoryLength })}
              />
            )}
          </Field>
          <Field label="Must happen" hint="Moments, twists or facts the story has to have.">
            {(id) => <AutoTextarea id={id} value={brief.mustHappen} minRows={2} maxRows={10} onChange={(e) => patchBrief(storyId, { mustHappen: e.target.value })} />}
          </Field>
          <Field label="Must never happen" hint="Anything to leave out.">
            {(id) => <AutoTextarea id={id} value={brief.avoid} minRows={2} maxRows={10} onChange={(e) => patchBrief(storyId, { avoid: e.target.value })} />}
          </Field>
        </div>
        <MineList storyId={storyId} mine={brief.mine} />
        <Questions storyId={storyId} />
      </div>
      <div className="flex flex-col gap-5">
        <StoryStyle storyId={storyId} />
        <RecipeCard storyId={storyId} />
      </div>
    </div>
  )
}

/** What a length lays out at first: the outline step can always ask for more or less. */
function lengthHint(length: StoryLength): string {
  const size = sizeForLength(length, 0)
  const acts = size.acts ? `${size.acts} acts and ` : ''
  return `${length ? 'A new outline starts' : 'Until you choose, a new outline starts'} with ${acts}${size.chapters} chapters of ${size.scenes} scenes each. You can change that on the Outline step.`
}

// ---------- His own characters and places ----------

function MineList({ storyId, mine }: { storyId: ID; mine: BriefEntry[] }): React.JSX.Element {
  const set = (i: number, patch: Partial<BriefEntry>): void => patchBrief(storyId, (b) => ({ mine: b.mine.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))
  return (
    <section aria-label="Your own characters and places" className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-fg">Your own characters, places and more</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">Anyone or anything you already have in mind. The AI keeps them exactly as you write them, names and all, and builds the rest around them.</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {mine.map((e, i) => (
          <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-start gap-2" data-mine>
            <Select ariaLabel="Kind" value={e.kind} options={KINDS} onChange={(v) => v && set(i, { kind: v as EntryKind })} />
            <div className="flex flex-col gap-1.5">
              <Input aria-label="Name" value={e.name} placeholder="Name" onChange={(ev) => set(i, { name: ev.target.value })} />
              <AutoTextarea aria-label="Who or what it is" value={e.about} minRows={1} maxRows={6} placeholder="Who or what it is" onChange={(ev) => set(i, { about: ev.target.value })} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              aria-label={`Remove ${e.name || 'this'}`}
              onClick={() => {
                const was = mine
                patchBrief(storyId, { mine: mine.filter((_, j) => j !== i) })
                toast(`Removed ${e.name.trim() || 'it'}.`, { action: { label: 'Undo', run: () => patchBrief(storyId, { mine: was }) } })
              }}
            />
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus size={13} />} onClick={() => patchBrief(storyId, (b) => ({ mine: [...b.mine, { kind: 'character', name: '', about: '' }] }))}>
        Add one
      </Button>
    </section>
  )
}

// ---------- Questions ----------

function Questions({ storyId }: { storyId: ID }): React.JSX.Element {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])!
  const q = b.question
  const answers = b.brief!.answers
  const [answer, setAnswer] = useState('')
  const id = useId()
  useEffect(() => setAnswer(''), [q?.question])
  return (
    <section aria-label="Questions" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <CircleHelp size={14} className="text-ai" aria-hidden />
        <h2 className="text-[13px] font-semibold text-fg">Ask me questions</h2>
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">Optional. The AI asks about what your idea leaves open, one question at a time. Skip any, stop whenever you like.</p>
      {answers.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {answers.map((a, i) => (
            <li key={i} className="group flex items-start gap-2 text-[12.5px] leading-relaxed">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-fg">{a.topic || 'More'}:</span> <span className="text-muted">{a.answer}</span>
              </span>
              <button type="button" className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus:opacity-100" aria-label="Remove this answer" onClick={() => removeAnswer(storyId, i)}>
                <X size={12} className="text-faint" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {q?.taskId ? (
        <div className="mt-3 flex items-center gap-2">
          <LampStatus text="Thinking of a question…" />
          <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopQuestion(storyId)}>
            Stop
          </Button>
        </div>
      ) : q?.question ? (
        <div className="mt-3 rounded-lg border border-ai/30 bg-ai-soft p-3">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            {q.question}
          </label>
          <AutoTextarea
            id={id}
            value={answer}
            minRows={2}
            maxRows={8}
            autoFocus
            className="mt-2 text-[13.5px]"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                answerQuestion(storyId, answer)
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => stopQuestion(storyId)}>
              Stop asking
            </Button>
            <Button size="sm" variant="ghost" onClick={() => answerQuestion(storyId, '')}>
              Skip
            </Button>
            <Button size="sm" variant="primary" disabled={!answer.trim()} onClick={() => answerQuestion(storyId, answer)}>
              Answer
            </Button>
          </div>
        </div>
      ) : (
        <>
          {q?.error ? (
            <div className="mt-3">
              <Notice tone="danger">{q.error}</Notice>
            </div>
          ) : null}
          <Button size="sm" variant="ai" className="mt-3" icon={<CircleHelp size={13} />} onClick={() => void askQuestion(storyId)}>
            {answers.length ? 'Ask me more' : 'Ask me questions'}
          </Button>
        </>
      )}
    </section>
  )
}

// ---------- The story's style ----------

function StoryStyle({ storyId }: { storyId: ID }): React.JSX.Element {
  const story = useApp((s) => s.stories.find((st) => st.id === storyId))!
  const world = useApp((s) => s.world)
  const prefs = usePrefs((s) => s.prefs)
  const [tone, setTone] = useState(story.tone)
  useEffect(() => setTone(story.tone), [story.tone])
  const own = story.style ?? {}
  const below = effectiveStyle(prefs ?? ({} as never), world?.style ?? ({} as StyleGuide), {})
  const shown = effectiveStyle(prefs ?? ({} as never), world?.style ?? ({} as StyleGuide), own)

  const save = async (patch: { style?: Partial<StyleGuide>; tone?: string }): Promise<void> => {
    try {
      await api.updateStory(storyId, patch)
      await useApp.getState().refreshStories()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }
  const pick = (p: StylePreset): void => {
    const before = { style: { ...own }, tone: story.tone }
    void save({ style: withPreset({ ...own }, p), tone: p.tone }).then(() =>
      toast(`This story is now written as “${p.label}”.`, { action: { label: 'Undo', run: () => void save(before) } })
    )
  }

  return (
    <section aria-label="The story’s style" className="rounded-xl border border-line bg-surface p-4" data-story-style>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-fg">This story’s style</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Everything the AI writes for this story follows it: the plan, the codex and every draft.</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => void editStoryStyle(storyId)} title="Every part of the style guide for this story">
          Fine-tune
        </Button>
      </div>
      <div className="mt-3">
        <StylePresets value={shown} onPick={pick} compact />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Tone">
          {(id) => (
            <Input id={id} value={tone} placeholder="Wry, warm and hopeful" onChange={(e) => setTone(e.target.value)} onBlur={() => tone !== story.tone && void save({ tone })} />
          )}
        </Field>
        <div className="text-[12.5px] leading-relaxed text-muted">
          <p>
            <span className="font-medium text-fg">Point of view:</span> {shown.pov || 'Not set'}
          </p>
          <p>
            <span className="font-medium text-fg">Tense:</span> {shown.tense || 'Not set'}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[12px] font-medium text-muted">How far it goes</p>
        <IntensityControls value={own.intensity ?? {}} below={below.intensity} mode="story" onChange={(intensity) => void save({ style: { ...own, intensity } })} />
      </div>
    </section>
  )
}

// ---------- The recipe ----------

function RecipeCard({ storyId }: { storyId: ID }): React.JSX.Element {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])!
  const brief = b.brief!
  const [list, setList] = useState<RecipeSummary[] | null>(null)
  const [openPart, setOpenPart] = useState<RecipePartId | null>(null)
  useEffect(() => {
    void api
      .listRecipes()
      .then((l) => setList(l.filter((r) => r.status === 'ready')))
      .catch(() => setList([]))
  }, [])
  const parts = partsInUse(storyId)
  const tweaked = brief.recipe ? Object.keys(brief.recipe.tweaks).length : 0
  const scope = recipeScope(storyId)

  return (
    <section aria-label="Recipe" className="rounded-xl border border-line bg-surface p-4" data-recipe-card>
      <div className="flex items-center gap-2">
        <CookingPot size={14} className="text-muted" aria-hidden />
        <h2 className="text-[13px] font-semibold text-fg">Follow a recipe</h2>
        <span className="text-[12px] text-faint">Optional</span>
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">The shape, beats, cast roles and pacing of a story you admire, told through your own idea. Your idea wins where they differ.</p>
      {!brief.recipe ? (
        list === null ? null : list.length ? (
          <div className="mt-3">
            <Select ariaLabel="Recipe" value={null} placeholder="Choose a recipe…" options={list.map((r) => ({ value: r.id, label: r.name || 'Untitled recipe' }))} onChange={(v) => v && void pickRecipe(storyId, v)} />
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-faint">You have no recipes yet. Make one from a story you admire in Recipes.</p>
        )
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold text-fg">{b.recipe?.name || 'The recipe'}</p>
            {tweaked ? (
              <Button size="sm" variant="ghost" onClick={() => void saveRecipeBack(storyId)} title="Save the changes you made for this story into the recipe in your library">
                Save changes to the recipe
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => dropRecipe(storyId)}>
              Stop following it
            </Button>
          </div>
          {tweaked ? <p className="mt-1 text-[12px] text-faint">Changed for this story: {Object.keys(brief.recipe.tweaks).map((k) => PART_LABELS[k as RecipePartId]).join(', ')}. The recipe in your library is as it was.</p> : null}
          {parts ? (
            <div className="mt-3 flex flex-col divide-y divide-line rounded-lg border border-line">
              {RECIPE_PARTS.filter((k) => k !== 'sample' && parts[k].trim()).map((k) => (
                <div key={k} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 text-left text-[12.5px] font-medium text-fg" aria-expanded={openPart === k} onClick={() => setOpenPart((p) => (p === k ? null : k))}>
                      {PART_LABELS[k]}
                      {brief.recipe?.tweaks[k] !== undefined ? <span className="ml-1.5 text-[11px] font-normal text-ai">changed</span> : null}
                    </button>
                    <PartRedo parts={parts} part={k} onUse={(text) => setRecipePart(storyId, k, text)} />
                  </div>
                  {openPart === k ? (
                    <AutoTextarea aria-label={PART_LABELS[k]} value={parts[k]} minRows={2} maxRows={14} className="mt-1.5 text-[12.5px]" onChange={(e) => setRecipePart(storyId, k, e.target.value)} />
                  ) : (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{parts[k]}</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          <RecipeTalkPanel
            scope={scope}
            className="mt-3"
            parts={parts}
            intro="Change the recipe for this story: “make it a heist instead of a mystery”, “give the mentor a darker turn”. You see the change first."
            onSay={(m) => void talkParts(scope, () => partsInUse(storyId), m)}
            onApply={() => applyRecipeTalk(storyId)}
            onDecline={() => settlePreview(scope, 'declined')}
          />
        </>
      )}
    </section>
  )
}
