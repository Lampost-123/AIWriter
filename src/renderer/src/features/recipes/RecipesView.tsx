// Story recipes (View 'recipes'; spec, "Story recipes"): the recipe library, making a recipe from a story, and one
// recipe to read and change. A recipe is the story's themes, writing style and structure, without its words. The
// library lives on this computer only (the Recipes folder of the library folder), outside every world. Works with
// or without a world open. Owned by the Story recipes part.

import { BookOpenText, ClipboardPaste, CookingPot, Copy, FileText, FileUp, Merge, Plus, RotateCcw, Trash2 } from '@/components/ui/icons'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Manuscript } from '@shared/contracts/importing'
import type { RecipeEstimate } from '@shared/contracts/recipes'
import { Button, Card, EmptyState, IconButton, Input, Textarea, useToastsAbove } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import { Segmented } from '@/features/generate/parts'
import { buildOutline, mergeBack, outlineCounts, wordsText, type OutlineChapter } from '@/features/importing/split'
import { useDesk } from '@/features/look/look'
import { DeskLibrary, DeskMake } from './DeskRecipes'
import { RecipePage } from './RecipePage'
import { dateWords, estimateWords, lengthWords, recipeName } from './recipeLogic'
import { BackButton, INTRO, Kicker, MakingCard } from './parts'
import {
  chooseStoryFile,
  clearStory,
  currentPlan,
  deleteRecipe,
  duplicate,
  listenForRecipes,
  makeRecipe,
  openRecipe,
  readPasted,
  resetRecipeSplit,
  setFrom,
  setPasted,
  setRecipeEdits,
  setRecipeName,
  startMaking,
  useRecipes,
  writeOne
} from './recipeStore'

export function RecipesView({ page, recipeId }: { page?: 'list' | 'make' | 'recipe'; recipeId?: string | null }): React.JSX.Element {
  useEffect(() => listenForRecipes(), [])
  const desk = useDesk()
  // The desk: the library and the recipe maker as pages of their own (DeskRecipes.tsx); a recipe's own page decides itself.
  if (desk && page !== 'recipe') return page === 'make' ? <DeskMake /> : <DeskLibrary />
  return (
    <div className="flex h-full flex-col bg-bg">
      {page === 'make' ? <MakePage /> : page === 'recipe' && recipeId ? <RecipePage key={recipeId} recipeId={recipeId} /> : <LibraryPage />}
    </div>
  )
}

// ---------- The library ----------

function LibraryPage(): React.JSX.Element {
  const list = useRecipes((s) => s.list)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[760px] px-8 pb-24 pt-10">
        <BackButton to="writing" />
        <Kicker />
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">Story recipes</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {INTRO} Make one from a story you admire, then start a new story of your own from it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" icon={<FileUp size={15} />} onClick={startMaking}>
            Make a recipe from a story
          </Button>
          <Button icon={<Plus size={15} />} onClick={() => void writeOne()}>
            Write one yourself
          </Button>
        </div>
        <MakingCard />
        {/* Nothing until the list is known, so it never flashes "No recipes yet". */}
        {list === null ? null : list.length === 0 ? (
          <EmptyState icon={<CookingPot size={20} />} title="No recipes yet" className="mt-6">
            Bring in a story as a Word, Markdown or text file, or paste it. The AI reads it and writes down how it is made.
          </EmptyState>
        ) : (
          <ul className="mt-6 flex flex-col gap-2" aria-label="Recipes">
            {list.map((r) => (
              <li key={r.id}>
                <Card className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openRecipe(r.id)}
                    className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span className="block truncate font-serif text-[16px] font-semibold text-fg">{recipeName(r)}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                      {r.status === 'making' ? 'Being made · ' : r.status === 'paused' ? 'Paused · ' : ''}
                      {lengthWords(r)} · {dateWords(r.createdAt)}
                    </span>
                  </button>
                  <IconButton label={`Make a copy of “${recipeName(r)}”`} size="sm" disabled={r.status !== 'ready'} onClick={() => void duplicate(r.id)}>
                    <Copy size={14} />
                  </IconButton>
                  <IconButton label={`Delete “${recipeName(r)}”`} size="sm" onClick={() => void deleteRecipe(r)}>
                    <Trash2 size={14} />
                  </IconButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 text-[12px] leading-relaxed text-faint">
          Recipes stay on this computer, in the Recipes folder of your library. They are never part of a world, a world file or a backup.
        </p>
      </div>
    </div>
  )
}

// ---------- Making one ----------

function MakePage(): React.JSX.Element {
  const manuscript = useRecipes((s) => s.manuscript)
  const from = useRecipes((s) => s.from)
  const problem = useRecipes((s) => s.problem)
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-[780px] px-8 pb-10 pt-10">
          <BackButton to="library" />
          <Kicker />
          <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">Make a recipe</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            {manuscript
              ? 'Check how it splits into chapters: the AI reads it a chapter at a time. Merge any that belong together. Nothing is sent until you press Make the recipe.'
              : `Bring in a story you admire. The AI reads it chapter by chapter and writes down how it is made. ${INTRO}`}
          </p>
          {problem ? (
            <div className="mt-4">
              <ProblemNotice message={problem.message} code={problem.code} />
            </div>
          ) : null}
          {manuscript ? (
            <Preview manuscript={manuscript} />
          ) : (
            <>
              <Segmented
                label="How the story comes in"
                className="mt-5"
                value={from}
                onChange={setFrom}
                options={[
                  { value: 'file', label: 'From a file' },
                  { value: 'paste', label: 'Paste the text' }
                ]}
              />
              {from === 'file' ? <ChooseFile /> : <PasteBox />}
            </>
          )}
        </div>
      </div>
      {manuscript ? <MakeBar /> : null}
    </>
  )
}

export function ChooseFile(): React.JSX.Element {
  const reading = useRecipes((s) => s.reading)
  return (
    <Card className="mt-4 flex flex-col items-center px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">
        <FileText size={20} />
      </div>
      <p className="mt-3 text-[14px] font-medium text-fg">Word, Markdown or plain text</p>
      <p className="mt-1 max-w-[380px] text-[13px] leading-relaxed text-muted">
        A .docx, .md or .txt file. Chapters are found by their headings (“Chapter 12”, “Prologue”, Word’s heading styles).
      </p>
      <Button variant="primary" size="lg" className="mt-5" icon={<FileUp size={15} />} loading={reading} onClick={() => void chooseStoryFile()}>
        {reading ? 'Reading the file…' : 'Choose a file…'}
      </Button>
    </Card>
  )
}

export function PasteBox(): React.JSX.Element {
  const pasted = useRecipes((s) => s.pasted)
  const reading = useRecipes((s) => s.reading)
  const id = useId()
  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        The story’s text
      </label>
      <Textarea
        id={id}
        value={pasted}
        minRows={10}
        maxRows={22}
        placeholder="Paste the whole story here. Put each chapter’s heading on a line of its own, such as “Chapter 1”."
        className="mt-1 font-serif text-[14px] placeholder:font-sans placeholder:text-[13px]"
        onChange={(e) => setPasted(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button variant="primary" icon={<ClipboardPaste size={14} />} loading={reading} disabled={!pasted.trim()} onClick={() => void readPasted()}>
          Read it
        </Button>
        <span className="text-[12px] tabular-nums text-faint">{pasted.trim() ? wordsText(pasted.trim().split(/\s+/).length) : ''}</span>
      </div>
    </div>
  )
}

/** The story read in: its name and what it holds (`part` 'meta'), its chapters ('list'), or both (the panels). */
export function Preview({ manuscript, part = 'all' }: { manuscript: Manuscript; part?: 'all' | 'meta' | 'list' }): React.JSX.Element {
  const proposed = useRecipes((s) => s.proposed)
  const edits = useRecipes((s) => s.edits)
  const name = useRecipes((s) => s.name)
  const outline = useMemo(() => buildOutline(manuscript, proposed, edits), [manuscript, proposed, edits])
  const changed = Object.keys(edits.roles).length > 0
  const nameId = useId()
  const merge = (at: number): void => setRecipeEdits(mergeBack(useRecipes.getState().edits, manuscript.blocks, proposed, at))
  if (part === 'list') {
    return (
      <ol className="plan-chapters" aria-label="Chapters">
        {outline.chapters.map((c, i) => (
          <ChapterRow key={c.key} chapter={c} first={i === 0} canMerge={i > 0 && c.at >= 0} onMerge={() => merge(c.at)} n={i} />
        ))}
      </ol>
    )
  }
  if (part === 'meta') {
    return (
      <div className="flex flex-col gap-4">
        <div className="plan-group">
          <label htmlFor={nameId} className="plan-field-l">
            The recipe’s name
          </label>
          <Input id={nameId} value={name} placeholder="Leave it empty and the AI suggests one" onChange={(e) => setRecipeName(e.target.value)} />
          <p className="plan-hint">Never the story’s own title: a recipe keeps none of its words.</p>
        </div>
        <div className="plan-receipt">
          <span className="plan-receipt-k">The story</span>
          <p className="plan-receipt-t flex min-w-0 items-center gap-1.5">
            <FileText size={14} className="shrink-0 text-faint" />
            <span className="truncate">{manuscript.fileName}</span>
          </p>
          <p className="plan-receipt-s tabular-nums">
            {wordsText(outline.words)} · {outlineCounts(outline)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {changed ? (
              <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={resetRecipeSplit}>
                Undo my changes
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon={<FileUp size={13} />} onClick={clearStory}>
              Choose another story
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-6">
      <div className="flex max-w-[460px] flex-col gap-1">
        <label htmlFor={nameId} className="text-[12px] font-medium text-muted">
          The recipe’s name
        </label>
        <Input id={nameId} value={name} placeholder="Leave it empty and the AI suggests one" onChange={(e) => setRecipeName(e.target.value)} />
        <p className="text-[12px] text-faint">Never the story’s own title: a recipe keeps none of its words.</p>
      </div>
      <div className="mt-4 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-faint" />
          <span className="truncate font-medium text-fg">{manuscript.fileName}</span>
        </span>
        <span className="tabular-nums">{wordsText(outline.words)}</span>
        <span>{outlineCounts(outline)}</span>
        <span className="flex-1" />
        {changed ? (
          <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={resetRecipeSplit}>
            Undo my changes
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<FileUp size={13} />} onClick={clearStory}>
          Choose another story
        </Button>
      </div>
      <ol className="mt-3 flex flex-col gap-2" aria-label="Chapters">
        {outline.chapters.map((c, i) => (
          <ChapterRow
            key={c.key}
            chapter={c}
            first={i === 0}
            canMerge={i > 0 && c.at >= 0}
            onMerge={() => merge(c.at)}
          />
        ))}
      </ol>
    </div>
  )
}

function ChapterRow({
  chapter: c,
  canMerge,
  onMerge,
  n
}: {
  chapter: OutlineChapter
  first: boolean
  canMerge: boolean
  onMerge: () => void
  /** On the desk: its place, and it is an index card. */
  n?: number
}): React.JSX.Element {
  const opening = c.scenes[0]?.opening ?? ''
  if (n !== undefined) {
    return (
      <li aria-label={`Chapter: ${c.title}`} className="plan-icard plan-chapcard is-kept">
        <div className="plan-ic-kind">
          <span>Chapter {n + 1}</span>
          <span className="plan-ic-when tabular-nums">
            · {wordsText(c.words)} · {c.scenes.length === 1 ? '1 scene' : `${c.scenes.length} scenes`}
          </span>
        </div>
        <p className="plan-ic-title truncate">{c.title}</p>
        <p className="plan-chapcard-open font-serif" title={opening}>
          {opening || <span className="font-sans italic text-faint">No words</span>}
        </p>
        {canMerge ? (
          <button type="button" className="plan-txt plan-chapcard-merge" aria-label="Merge with the chapter before" title="Merge with the chapter before" onClick={onMerge}>
            <Merge size={14} aria-hidden /> Merge
          </button>
        ) : null}
      </li>
    )
  }
  return (
    <li
      aria-label={`Chapter: ${c.title}`}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 shadow-soft [contain-intrinsic-size:auto_56px] [content-visibility:auto]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold text-fg">{c.title}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-faint">
            {wordsText(c.words)} · {c.scenes.length === 1 ? '1 scene' : `${c.scenes.length} scenes`}
          </span>
        </div>
        <p className="truncate font-serif text-[13px] text-muted" title={opening}>
          {opening || <span className="font-sans italic text-faint">No words</span>}
        </p>
      </div>
      {canMerge ? (
        <IconButton label="Merge with the chapter before" size="sm" onClick={onMerge}>
          <Merge size={14} />
        </IconButton>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}
    </li>
  )
}

/** The foot of the page: what it costs, and Make the recipe. Toasts rise above it. */
export function MakeBar(): React.JSX.Element {
  const manuscript = useRecipes((s) => s.manuscript)
  const proposed = useRecipes((s) => s.proposed)
  const edits = useRecipes((s) => s.edits)
  const starting = useRecipes((s) => s.starting)
  const settings = useApp((s) => s.settings)
  const [estimate, setEstimate] = useState<RecipeEstimate | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  useToastsAbove(bar)
  // Worked out again (a moment after the split changes, or the models do), never sending anything.
  const models = JSON.stringify([settings?.models.recipe, settings?.models.memory, settings?.models.writer, settings?.thinking?.recipe])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      const plan = currentPlan()
      if (!plan) return
      api
        .estimateRecipe(plan)
        .then((e) => live && setEstimate(e))
        .catch(() => live && setEstimate(null))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [manuscript, proposed, edits, models])
  return (
    <div ref={bar} className="plan-makebar shrink-0 border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-[780px] px-8 py-3">
        {estimate?.problem ? (
          <div className="mb-2">
            <ProblemNotice message={estimate.problem} />
          </div>
        ) : null}
        <div className="flex min-h-10 items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-fg" aria-live="polite">
              {estimate && !estimate.problem ? estimateWords(estimate) : estimate ? '' : <span className="text-faint">Working out the cost…</span>}
            </p>
            <p className="truncate text-[12px] text-faint" title="The story is sent only to the recipe maker model, and only while the recipe is made.">
              Sent only to the recipe maker model (Settings › Models), and only while the recipe is made.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            icon={<BookOpenText size={15} />}
            loading={starting}
            disabled={!!estimate?.problem}
            onClick={() => void makeRecipe()}
          >
            Make the recipe
          </Button>
        </div>
      </div>
    </div>
  )
}

