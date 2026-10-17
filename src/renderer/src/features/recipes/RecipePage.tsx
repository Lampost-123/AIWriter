// One recipe (View 'recipes', page 'recipe'): its name, then its parts grouped as Themes, Writing style and
// Structure, each plain text Adam can change (saved as he types; a part he changed is his, and reading the story
// again never overwrites it). While it is being made, how far it has got. Its actions: start a new story from it,
// make a copy, read the story again, forget the story's text, delete. Owned by the Story recipes part.

import { BookPlus, CookingPot, Copy, FileX2, RefreshCw, Trash2 } from '@/components/ui/icons'
import { useEffect, useId, useRef, useState } from 'react'
import type { Recipe, RecipePartId, RecipeParts, RecipePlanSaved } from '@shared/contracts/recipes'
import { Button, EmptyState, Input, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { useDesk } from '@/features/look/look'
import { PlanPage } from '@/features/planning/PlanShell'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { PART_GROUPS, PART_WORDS, dateWords, lengthWords, recipeName, unreadWords } from './recipeLogic'
import { BackButton, INTRO, Kicker, MakingCard } from './parts'
import { goOnPlanning } from './planStore'
import { deleteRecipe, duplicate, forgetSource, readAgain, refreshRecipes, startStoryFrom, useRecipes } from './recipeStore'
import { PartRedo, RecipeTalkPanel, talkParts } from './RecipeTalk'
import { settlePreview, talkOf } from '@/features/planning/talkStore'

export function RecipePage({ recipeId }: { recipeId: string }): React.JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [missing, setMissing] = useState<{ message: string; newer: boolean } | null>(null)
  // Read again when it finishes being made (or starts again), never while Adam types in it.
  const status = useRecipes((s) => s.list?.find((r) => r.id === recipeId)?.status ?? null)
  const hasSource = useRecipes((s) => s.list?.find((r) => r.id === recipeId)?.hasSource ?? null)
  useEffect(() => {
    let live = true
    api
      .getRecipe(recipeId)
      .then((r) => {
        if (!live) return
        setRecipe(r)
        setMissing(null)
      })
      .catch((e) => live && setMissing({ message: plainReason(e), newer: (e as { code?: string }).code === 'newer-recipe' }))
    return () => {
      live = false
    }
  }, [recipeId, status])

  if (missing) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState icon={<CookingPot size={20} />} title={missing.newer ? 'This recipe can’t be opened yet' : 'This recipe isn’t here any more'} actions={<BackButton to="library" />}>
          {missing.message}
        </EmptyState>
      </div>
    )
  }
  // Nothing until it has been read, so the page never draws empty parts first.
  if (!recipe) return <div className="h-full" />
  return <Loaded key={`${recipe.id}:${recipe.status}`} recipe={{ ...recipe, hasSource: hasSource ?? recipe.hasSource }} />
}

function Loaded({ recipe }: { recipe: Recipe }): React.JSX.Element {
  const hasWorld = useApp((s) => !!s.world)
  const [name, setName] = useState(recipe.name)
  const [parts, setParts] = useState<RecipeParts>(recipe.parts)
  const [edited, setEdited] = useState<RecipePartId[]>(recipe.edited)
  const saved = useRef<RecipeParts>(recipe.parts)
  const nameId = useId()
  const ready = recipe.status === 'ready'
  const desk = useDesk()

  const autosave = useAutosave<RecipeParts>(
    async (next) => {
      const patch: Partial<RecipeParts> = {}
      for (const k of Object.keys(next) as RecipePartId[]) if (next[k] !== saved.current[k]) patch[k] = next[k]
      if (!Object.keys(patch).length) return
      const r = await api.updateRecipe(recipe.id, { parts: patch })
      saved.current = { ...saved.current, ...patch }
      setEdited(r.edited)
    },
    { what: 'the recipe' }
  )

  const change = (k: RecipePartId, v: string): void => {
    setParts((p) => {
      const next = { ...p, [k]: v }
      autosave.schedule(next)
      return next
    })
  }

  // Talking the recipe over (2026-10-17): its changed parts go in only on Apply, saved as any change is.
  const talkScope = `recipe-page:${recipe.id}`
  const partsRef = useRef(parts)
  partsRef.current = parts
  const applyTalk = (): void => {
    const changed = talkOf(talkScope).preview as Partial<RecipeParts> | null
    if (!changed) return
    const before = { ...partsRef.current }
    setParts((p) => {
      const next = { ...p, ...changed }
      autosave.schedule(next)
      return next
    })
    settlePreview(talkScope, 'applied')
    toast('Changed the recipe.', {
      action: {
        label: 'Undo',
        run: () =>
          setParts(() => {
            autosave.schedule(before)
            return before
          })
      }
    })
  }
  const talk = (
    <RecipeTalkPanel
      scope={talkScope}
      parts={parts}
      className={desk ? undefined : 'mt-6'}
      intro="Tell the AI how to change this recipe: “make the middle act shorter”, “turn the mentor into a rival”. You see the change first, and Undo takes it back."
      onSay={(m) => void talkParts(talkScope, () => partsRef.current, m)}
      onApply={applyTalk}
      onDecline={() => settlePreview(talkScope, 'declined')}
    />
  )

  const commitName = async (): Promise<void> => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) {
      setName(recipe.name)
      return
    }
    if (clean === recipe.name) return
    try {
      await api.updateRecipe(recipe.id, { name: clean })
      await refreshRecipes()
    } catch (e) {
      setName(recipe.name)
      toast(plainReason(e), { tone: 'danger' })
    }
  }

  const actions = (
    <>
      <Button
        variant="primary"
        size={desk ? 'lg' : 'md'}
        icon={<BookPlus size={15} />}
        disabled={!hasWorld}
        title={hasWorld ? 'The New story dialog, with this recipe picked' : 'Open a world first: the new story goes into it.'}
        onClick={() => startStoryFrom(recipe.id)}
      >
        Start a new story from it
      </Button>
      <Button icon={<Copy size={14} />} onClick={() => void duplicate(recipe.id)}>
        Make a copy
      </Button>
      {recipe.hasSource && !recipe.byHand ? (
        <Button
          icon={<RefreshCw size={14} />}
          title="The AI reads the story again and writes the recipe afresh. The parts you changed stay as they are."
          onClick={() => void readAgain(recipe)}
        >
          Read the story again
        </Button>
      ) : null}
      {recipe.hasSource ? (
        <Button
          variant="ghost"
          icon={<FileX2 size={14} />}
          title="Removes the story’s text kept with this recipe. The recipe stays; it just can’t be read again."
          onClick={() => void forgetSource(recipe.id)}
        >
          Forget the story’s text
        </Button>
      ) : null}
      <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => void deleteRecipe(recipe)}>
        Delete
      </Button>
    </>
  )

  if (desk) {
    return (
      <PlanPage
        art="recipes"
        kicker="Story recipe"
        kickerIcon={CookingPot}
        back={<BackButton to="library" />}
        title={name.trim() || recipeName({ name: '', status: recipe.status })}
        line={`${lengthWords(recipe)} · ${dateWords(recipe.createdAt)}. ${INTRO} Change any part: it is saved as you type.`}
        left={
          <>
            <div className="plan-group">
              <div className="plan-field-l">
                <label htmlFor={nameId}>The recipe’s name</label>
                <SaveNote status={autosave.status} error={autosave.error} />
              </div>
              <Input
                id={nameId}
                value={name}
                placeholder={recipeName({ name: '', status: recipe.status })}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setName(recipe.name)
                }}
                className="h-11 font-serif text-[18px] font-semibold"
              />
            </div>
            <MakingCard recipe={recipe} />
            {ready ? <UnreadNote unread={recipe.unread} /> : null}
            {ready ? <div className="plan-recipe-actions">{actions}</div> : null}
            {ready && !hasWorld ? <p className="plan-hint">Open a world to start a new story from this recipe.</p> : null}
            {ready ? talk : null}
            {ready ? <PlannedStories recipeId={recipe.id} /> : null}
          </>
        }
        right={
          ready ? (
            <div className="plan-parts">
              {PART_GROUPS.map((g) => (
                <section key={g.title} aria-label={g.title} className="plan-partgroup plan-deal">
                  <h2 className="plan-partgroup-t">{g.title}</h2>
                  <div className="mt-3 flex flex-col gap-4">
                    {g.parts.map((k) => (
                      <Part key={k} part={k} value={parts[k]} all={parts} mine={edited.includes(k) && recipe.hasSource} onChange={(v) => change(k, v)} onBlur={() => void autosave.flush()} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null
        }
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[760px] px-8 pb-48 pt-10">
        <BackButton to="library" />
        <Kicker />
        <label htmlFor={nameId} className="sr-only">
          The recipe’s name
        </label>
        <Input
          id={nameId}
          value={name}
          placeholder={recipeName({ name: '', status: recipe.status })}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setName(recipe.name)
          }}
          className="-ml-2 mt-1 h-11 border-transparent bg-transparent px-2 font-serif text-[26px] font-semibold text-fg hover:border-line focus:bg-page"
        />
        <div className="mt-1 flex min-h-6 items-center gap-3 text-[12.5px] text-muted">
          <span className="min-w-0 truncate">
            {lengthWords(recipe)} · {dateWords(recipe.createdAt)}
          </span>
          <span className="flex-1" />
          <SaveNote status={autosave.status} error={autosave.error} />
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{INTRO}</p>

        <MakingCard recipe={recipe} />

        {ready ? (
          <>
            <UnreadNote unread={recipe.unread} />
            <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
            {!hasWorld ? <p className="mt-2 text-[12px] text-faint">Open a world to start a new story from this recipe.</p> : null}
            {talk}
            {PART_GROUPS.map((g) => (
              <section key={g.title} aria-label={g.title} className="mt-8">
                <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{g.title}</h2>
                <div className="mt-2 flex flex-col gap-4">
                  {g.parts.map((k) => (
                    <Part key={k} part={k} value={parts[k]} all={parts} mine={edited.includes(k) && recipe.hasSource} onChange={(v) => change(k, v)} onBlur={() => void autosave.flush()} />
                  ))}
                </div>
              </section>
            ))}
            {/* Last, so it arriving moves nothing (2026-10-17). */}
            <PlannedStories recipeId={recipe.id} />
          </>
        ) : null}
      </div>
    </div>
  )
}

/** The chapters the AI couldn't read when it made the recipe (2026-10-17), in plain words; nothing when it read them all. */
function UnreadNote({ unread }: { unread?: number[] }): React.JSX.Element | null {
  const words = unreadWords(unread)
  if (!words) return null
  return (
    <div className="mt-4">
      <Notice>{words}</Notice>
    </div>
  )
}

/**
 * Stories in the open world being planned from this recipe (kept with it, so they open again after a restart,
 * 2026-10-17): each with Go on planning. Nothing when there are none.
 */
function PlannedStories({ recipeId }: { recipeId: string }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id ?? null)
  const stories = useApp((s) => s.stories)
  const [saved, setSaved] = useState<RecipePlanSaved[]>([])
  useEffect(() => {
    let live = true
    api
      .listRecipePlans(recipeId)
      .then((p) => live && setSaved(p))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [recipeId, worldId])
  const here = saved.flatMap((p) => {
    const story = p.worldId === worldId ? stories.find((s) => s.id === p.storyId) : undefined
    return story ? [{ storyId: p.storyId, title: story.title.trim() || 'Untitled story' }] : []
  })
  if (!here.length) return null
  return (
    <section aria-label="Stories planned from it" className="mt-5 animate-fade-in">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Stories you are planning from it</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {here.map((s) => (
          <li key={s.storyId} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-serif text-fg">{s.title}</span>
            <Button size="sm" variant="ghost" onClick={() => void goOnPlanning(s.storyId, recipeId)}>
              Go on planning
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Part({
  part,
  value,
  mine,
  onChange,
  onBlur,
  all
}: {
  part: RecipePartId
  value: string
  mine: boolean
  onChange: (v: string) => void
  onBlur: () => void
  /** Every part, for writing this one again with the AI. */
  all?: RecipeParts
}): React.JSX.Element {
  const id = useId()
  const w = PART_WORDS[part]
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {w.label}
        </label>
        <span className="flex items-baseline gap-2">
          {mine ? <span className="text-[11.5px] text-faint">Changed by you: kept if the story is read again</span> : null}
          {all ? (
            <PartRedo
              parts={all}
              part={part}
              onUse={(text) => {
                const before = value
                onChange(text)
                toast(`Rewrote “${w.label}”.`, { action: { label: 'Undo', run: () => onChange(before) } })
              }}
            />
          ) : null}
        </span>
      </div>
      {w.short ? (
        <Input id={id} value={value} placeholder={w.hint} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className="mt-1" />
      ) : (
        <AutoTextarea
          id={id}
          value={value}
          minRows={part === 'sample' ? 5 : part === 'feel' ? 2 : 3}
          maxRows={30}
          placeholder={w.hint}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={part === 'sample' ? 'mt-1 font-serif text-[15px] leading-[1.6]' : 'mt-1 text-[13.5px]'}
        />
      )}
    </div>
  )
}
