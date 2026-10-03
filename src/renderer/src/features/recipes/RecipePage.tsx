// One recipe (View 'recipes', page 'recipe'): its name, then its parts grouped as Themes, Writing style and
// Structure, each plain text Adam can change (saved as he types; a part he changed is his, and reading the story
// again never overwrites it). While it is being made, how far it has got. Its actions: start a new story from it,
// make a copy, read the story again, forget the story's text, delete. Owned by the Story recipes part.

import { BookPlus, CookingPot, Copy, FileX2, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { Recipe, RecipePartId, RecipeParts } from '@shared/contracts/recipes'
import { Button, EmptyState, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { PART_GROUPS, PART_WORDS, dateWords, lengthWords, recipeName } from './recipeLogic'
import { BackButton, INTRO, Kicker, MakingCard } from './parts'
import { deleteRecipe, duplicate, forgetSource, readAgain, refreshRecipes, startStoryFrom, useRecipes } from './recipeStore'

export function RecipePage({ recipeId }: { recipeId: string }): React.JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
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
      .catch((e) => live && setMissing(plainReason(e)))
    return () => {
      live = false
    }
  }, [recipeId, status])

  if (missing) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState icon={<CookingPot size={20} />} title="This recipe isn’t here any more" actions={<BackButton to="library" />}>
          {missing}
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
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
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
                  onClick={() => void readAgain(recipe.id)}
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
            </div>
            {!hasWorld ? <p className="mt-2 text-[12px] text-faint">Open a world to start a new story from this recipe.</p> : null}
            {PART_GROUPS.map((g) => (
              <section key={g.title} aria-label={g.title} className="mt-8">
                <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{g.title}</h2>
                <div className="mt-2 flex flex-col gap-4">
                  {g.parts.map((k) => (
                    <Part key={k} part={k} value={parts[k]} mine={edited.includes(k) && recipe.hasSource} onChange={(v) => change(k, v)} onBlur={() => void autosave.flush()} />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </div>
  )
}

function Part({ part, value, mine, onChange, onBlur }: { part: RecipePartId; value: string; mine: boolean; onChange: (v: string) => void; onBlur: () => void }): React.JSX.Element {
  const id = useId()
  const w = PART_WORDS[part]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {w.label}
        </label>
        {mine ? <span className="text-[11.5px] text-faint">Changed by you: kept if the story is read again</span> : null}
      </div>
      {w.short ? (
        <Input id={id} value={value} placeholder={w.hint} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className="mt-1" />
      ) : (
        <AutoTextarea
          id={id}
          value={value}
          minRows={part === 'sample' ? 5 : 3}
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
