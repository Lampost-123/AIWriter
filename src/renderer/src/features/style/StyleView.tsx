import { BookOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultStyleGuide } from '@shared/defaults'
import { cleanGenres } from '@shared/genres'
import { cleanIntensity } from '@shared/intensity'
import { effectiveStyle, STYLE_TEXT_KEYS } from '@shared/style'
import type { Story, StyleGuide, World, WritingPrefs } from '@shared/types'
import { Button, EmptyState, Field, Input, Notice, Spinner, Tabs, TabsContent, TabsList } from '@/components/ui'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { api } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { createDraftCache } from '@/features/world/parts/draftCache'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'
import { usePrefs } from './prefsStore'
import { SampleWriter } from './SampleWriter'
import { StoryFeel } from './StoryFeel'
import { Group, short, StyleFields } from './StyleFields'

type Tab = 'world' | 'story'
let lastTab: Tab = 'world'

/** Opens the style guide on this tab the next time it is shown (story settings' "Change this story's style"). */
export function openStyleTab(tab: Tab): void {
  lastTab = tab
}

/** A full style guide from stored data, with every field present. */
const fullStyle = (s: Partial<StyleGuide> | undefined): StyleGuide => {
  const v: StyleGuide = { ...defaultStyleGuide(), ...(s ?? {}) }
  for (const k of STYLE_TEXT_KEYS) if (typeof v[k] !== 'string') v[k] = ''
  if (v.spelling !== 'UK' && v.spelling !== 'US') v.spelling = ''
  return {
    ...v,
    avoidPhrases: Array.isArray(v.avoidPhrases) ? v.avoidPhrases.filter((x) => typeof x === 'string') : [],
    genres: cleanGenres(v.genres),
    intensity: cleanIntensity(v.intensity)
  }
}

/** The world's style guide and themes, and the open story's premise and overrides. */
export function StyleView(): React.JSX.Element | null {
  const world = useApp((s) => s.world)
  const storyId = useApp((s) => s.storyId)
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const prefs = usePrefs((s) => s.prefs)
  const prefsError = usePrefs((s) => s.error)
  const [tab, setTab] = useState<Tab>(lastTab)
  const slow = useSlow(!prefs && !prefsError)

  useEffect(() => {
    void usePrefs.getState().load()
  }, [])

  if (!world) return null
  if (!prefs) {
    if (prefsError)
      return (
        <div className="mx-auto max-w-md px-6 pt-16">
          <Notice
            tone="danger"
            action={
              <Button size="sm" onClick={() => void usePrefs.getState().load()}>
                Try again
              </Button>
            }
          >
            Couldn't load your writing preferences. {prefsError}
          </Notice>
        </div>
      )
    return slow ? (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner />
      </div>
    ) : null
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[680px] animate-fade-in px-8 pb-24 pt-8">
        <h1 className="text-[20px] font-semibold text-fg">Style guide</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          How every draft should read. Your own writing preferences sit underneath, the world's guide goes on top, and each story can change anything for itself.
        </p>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            lastTab = v as Tab
            setTab(v as Tab)
          }}
          className="mt-5"
        >
          <TabsList
            className="mb-6 px-0!"
            items={[
              { value: 'world', label: 'World' },
              { value: 'story', label: 'This story' }
            ]}
          />
          <TabsContent value="world">
            <WorldStyleForm key={world.id} world={world} prefs={prefs} />
          </TabsContent>
          <TabsContent value="story">
            {story ? (
              <StoryStyleForm key={story.id} story={story} world={world} prefs={prefs} />
            ) : (
              <EmptyState icon={<BookOpen size={20} />} title="No story is open">
                {storyId ? 'That story could not be found.' : 'Open a story in the binder to give it its own premise and style.'}
              </EmptyState>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ---------- World ----------

interface WorldDraft {
  style: StyleGuide
  themes: string
  tone: string
}
const worldDrafts = createDraftCache<WorldDraft>()

function WorldStyleForm({ world, prefs }: { world: World; prefs: WritingPrefs }): React.JSX.Element {
  const [draft, setDraftState] = useState<WorldDraft>(
    () => worldDrafts.get(world.id) ?? { style: fullStyle(world.style), themes: world.themes, tone: world.tone }
  )
  const ref = useRef(draft)
  const autosave = useAutosave<WorldDraft>(
    async (d) => {
      await api.updateWorld({ style: d.style, themes: d.themes, tone: d.tone })
      worldDrafts.confirm(world.id, d)
      await useApp.getState().refreshWorld()
    },
    { what: "the world's style guide" }
  )
  const { schedule } = autosave
  useEffect(() => {
    const d = worldDrafts.get(world.id)
    if (d) schedule(d)
  }, [world.id, schedule])

  const update = useCallback(
    (patch: Partial<WorldDraft>) => {
      const next = { ...ref.current, ...patch }
      ref.current = next
      setDraftState(next)
      worldDrafts.set(world.id, next)
      schedule(next)
    },
    [schedule, world.id]
  )
  const onStyle = useCallback((patch: Partial<StyleGuide>) => update({ style: { ...ref.current.style, ...patch } }), [update])

  // Underneath the world sit only Adam's own preferences.
  const below = useMemo(() => effectiveStyle(prefs, defaultStyleGuide(), {}), [prefs])
  // The style a sample is written in: the world's guide as on screen, over Adam's preferences.
  const sampleStyle = useCallback(() => effectiveStyle(prefs, ref.current.style, {}), [prefs])
  const putSample = useCallback((samplePassage: string) => onStyle({ samplePassage }), [onStyle])

  return (
    <div className="flex flex-col gap-8" onBlur={() => void autosave.flush()}>
      <div className="-mb-4 flex items-center justify-between gap-4">
        <p className="text-[12.5px] text-muted">Applies to every story in {world.name}.</p>
        <SaveNote status={autosave.status} error={autosave.error} />
      </div>
      <StoryFeel value={draft.style} onChange={onStyle} below={below} mode="world" />
      <StyleFields
        value={draft.style}
        onChange={onStyle}
        below={below}
        prefsPhrases={prefs.avoidWords}
        mode="world"
        afterSample={<SampleWriter worldId={world.id} storyId={null} style={sampleStyle} current={draft.style.samplePassage} onUse={putSample} />}
      />
      <Group title="Themes and tone">
        <Field label="World themes" hint="What the world is about underneath, and how it should surface.">
          {(id) => (
            <AutoTextarea
              id={id}
              value={draft.themes}
              minRows={3}
              maxRows={14}
              placeholder="Power and what it costs. Loyalty tested by hunger. Small kindnesses in hard places."
              onChange={(e) => update({ themes: e.target.value })}
            />
          )}
        </Field>
        <Field label="World tone">
          {(id) => <Input id={id} value={draft.tone} placeholder="Grim but warm, with dry humour" onChange={(e) => update({ tone: e.target.value })} />}
        </Field>
      </Group>
    </div>
  )
}

// ---------- This story ----------

interface StoryDraft {
  premise: string
  themes: string
  tone: string
  style: StyleGuide
}
const storyDrafts = createDraftCache<StoryDraft>()
// After a backup is restored these copies are from the world before it: never write them back.
registerDiscarder(() => {
  worldDrafts.clear()
  storyDrafts.clear()
})

function StoryStyleForm({ story, world, prefs }: { story: Story; world: World; prefs: WritingPrefs }): React.JSX.Element {
  const [draft, setDraftState] = useState<StoryDraft>(
    () => storyDrafts.get(story.id) ?? { premise: story.premise, themes: story.themes, tone: story.tone, style: fullStyle(story.style) }
  )
  const ref = useRef(draft)
  const autosave = useAutosave<StoryDraft>(
    async (d) => {
      await api.updateStory(story.id, { premise: d.premise, themes: d.themes, tone: d.tone, style: d.style })
      storyDrafts.confirm(story.id, d)
      await useApp.getState().refreshStories()
    },
    { what: story.title.trim() ? `"${story.title.trim()}"` : 'this story' }
  )
  const { schedule } = autosave
  useEffect(() => {
    const d = storyDrafts.get(story.id)
    if (d) schedule(d)
  }, [story.id, schedule])

  const update = useCallback(
    (patch: Partial<StoryDraft>) => {
      const next = { ...ref.current, ...patch }
      ref.current = next
      setDraftState(next)
      storyDrafts.set(story.id, next)
      schedule(next)
    },
    [schedule, story.id]
  )
  const onStyle = useCallback((patch: Partial<StyleGuide>) => update({ style: { ...ref.current.style, ...patch } }), [update])

  // Underneath a story: the world's guide, then Adam's preferences.
  const below = useMemo(() => effectiveStyle(prefs, fullStyle(world.style), {}), [prefs, world.style])
  // The style a sample is written in: the story's guide as on screen, over the world's and Adam's preferences.
  const sampleStyle = useCallback(() => effectiveStyle(prefs, fullStyle(world.style), ref.current.style), [prefs, world.style])
  const putSample = useCallback((samplePassage: string) => onStyle({ samplePassage }), [onStyle])

  return (
    <div className="flex flex-col gap-8" onBlur={() => void autosave.flush()}>
      <div className="-mb-4 flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-[12.5px] text-muted">
          For <span className="font-medium text-fg">{story.title || 'Untitled story'}</span> only. Leave a field empty to use the world's.
        </p>
        <SaveNote status={autosave.status} error={autosave.error} />
      </div>
      <StoryFeel value={draft.style} onChange={onStyle} below={below} mode="story" />
      <Group title="About this story">
        <Field label="Premise" hint="What this story is about, in a few sentences. The AI keeps it in mind for every scene.">
          {(id) => (
            <AutoTextarea
              id={id}
              value={draft.premise}
              minRows={3}
              maxRows={14}
              placeholder="A ferryman who owes the Duke money is paid to smuggle the heir out of Varn."
              onChange={(e) => update({ premise: e.target.value })}
            />
          )}
        </Field>
        <Field label="Themes">
          {(id) => (
            <AutoTextarea
              id={id}
              value={draft.themes}
              minRows={2}
              maxRows={10}
              placeholder={world.themes.trim() ? `The world's themes still apply: ${short(world.themes, 90)}` : 'What this story is about underneath'}
              onChange={(e) => update({ themes: e.target.value })}
            />
          )}
        </Field>
        <Field label="Tone">
          {(id) => (
            <Input
              id={id}
              value={draft.tone}
              placeholder={world.tone.trim() ? `Uses the world's: ${short(world.tone, 90)}` : 'How this story should feel'}
              onChange={(e) => update({ tone: e.target.value })}
            />
          )}
        </Field>
      </Group>
      <StyleFields
        value={draft.style}
        onChange={onStyle}
        below={below}
        prefsPhrases={prefs.avoidWords}
        mode="story"
        afterSample={<SampleWriter worldId={world.id} storyId={story.id} style={sampleStyle} current={draft.style.samplePassage} onUse={putSample} />}
      />
    </div>
  )
}
