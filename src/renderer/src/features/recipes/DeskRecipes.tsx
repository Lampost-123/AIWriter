// Story recipes on the desk (UI overhaul, "the AI planning pages"): the library and the recipe maker as pages of their
// own, with the recipe book drawn in their header band. The library's recipes stand as books on a shelf, each its own
// colour (steady per recipe), with its name in the serif on the cover, how long the story was and when it was made;
// Copy and Delete as before. The maker is a wizard: bring a story in (a file or pasted), check how it splits into
// chapters (they lie on the right as index cards, Merge on each), then Make the recipe, its cost in the bar at the foot.
// The same actions and stores as the panels (RecipesView.tsx, recipeStore.ts).
import { BookOpenText, CookingPot, Copy, FileText, FileUp, Plus, Trash2 } from '@/components/ui/icons'
import { Button, IconButton } from '@/components/ui'
import { ProblemNotice } from '@/features/builder/parts'
import { Segmented } from '@/features/generate/parts'
import { PlanPage, ResultsEmpty } from '@/features/planning/PlanShell'
import { recipeSteps } from '@/features/planning/planLogic'
import { useDealDelay } from '@/features/planning/deal'
import { cn } from '@/lib/cn'
import type { RecipeSummary } from '@shared/contracts/recipes'
import { buildOutline } from '@/features/importing/split'
import { dateWords, lengthWords, recipeName } from './recipeLogic'
import { BackButton, INTRO, MakingCard } from './parts'
import { ChooseFile, MakeBar, PasteBox, Preview } from './RecipesView'
import { deleteRecipe, duplicate, openRecipe, setFrom, startMaking, useRecipes, writeOne } from './recipeStore'

/** A recipe's own colour on the shelf, steady for its id. */
function hueOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return [12, 26, 38, 150, 172, 344, 4][h % 7]
}

export function DeskLibrary(): React.JSX.Element {
  const list = useRecipes((s) => s.list)
  return (
    <PlanPage
      art="recipes"
      kicker="Story recipes"
      kickerIcon={CookingPot}
      title="Story recipes"
      line={`${INTRO} Make one from a story you admire, then start a new story of your own from it.`}
      left={
        <>
          <div className="flex flex-col gap-2">
            <button type="button" className="plan-ai-btn" onClick={startMaking}>
              <FileUp size={17} aria-hidden />
              <span>Make a recipe from a story</span>
            </button>
            <Button size="lg" icon={<Plus size={15} />} onClick={() => void writeOne()}>
              Write one yourself
            </Button>
          </div>
          <MakingCard />
          <div className="plan-receipt">
            <span className="plan-receipt-k">How it works</span>
            <ol className="plan-howto">
              <li>Bring in a story as a Word, Markdown or text file, or paste it.</li>
              <li>The AI reads it a chapter at a time and writes down how it is made: its themes, its style, its shape.</li>
              <li>Start a new story from the recipe, told your way.</li>
            </ol>
          </div>
          <p className="plan-hint">
            Recipes stay on this computer, in the Recipes folder of your library. They are never part of a world, a world file or a backup.
          </p>
        </>
      }
      right={
        // Nothing until the list is known, so it never flashes "No recipes yet".
        list === null ? null : list.length === 0 ? (
          <ResultsEmpty
            title="No recipes yet"
            example={
              <>
                A recipe for a quiet coastal mystery might say: <em>an outsider arrives and is offered a place</em>; close third person, past tense;
                three acts, the second turning on <em>a letter nobody meant to send</em>. None of the story’s own words or names.
              </>
            }
          >
            Bring in a story as a Word, Markdown or text file, or paste it. The AI reads it and writes down how it is made.
          </ResultsEmpty>
        ) : (
          <section aria-label="Your recipes">
            <div className="plan-tray">
              <h2 className="plan-tray-t">Your recipes</h2>
              <span className="plan-count">
                <b>{list.length}</b> on the shelf
              </span>
            </div>
            <ul className="plan-shelf" aria-label="Recipes">
              {list.map((r) => (
                <li key={r.id}>
                  <Book recipe={r} />
                </li>
              ))}
            </ul>
          </section>
        )
      }
    />
  )
}

/** One recipe as a book on the shelf: its cover opens it. */
function Book({ recipe: r }: { recipe: RecipeSummary }): React.JSX.Element {
  const deal = useDealDelay()
  const name = recipeName(r)
  return (
    <article className={cn('plan-book plan-deal', r.status !== 'ready' && 'is-making')} style={{ ...deal, '--book-h': hueOf(r.id) } as React.CSSProperties}>
      <button type="button" onClick={() => openRecipe(r.id)} className="plan-book-cover">
        <span className="plan-book-spine" aria-hidden />
        <span className="plan-book-band" aria-hidden />
        <span className="plan-book-name">{name}</span>
        <span className="plan-book-meta">
          {r.status === 'making' ? 'Being made · ' : r.status === 'paused' ? 'Paused · ' : ''}
          {lengthWords(r)} · {dateWords(r.createdAt)}
        </span>
      </button>
      <div className="plan-book-actions">
        <IconButton label={`Make a copy of “${name}”`} size="sm" disabled={r.status !== 'ready'} onClick={() => void duplicate(r.id)}>
          <Copy size={14} />
        </IconButton>
        <IconButton label={`Delete “${name}”`} size="sm" onClick={() => void deleteRecipe(r)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </article>
  )
}

export function DeskMake(): React.JSX.Element {
  const manuscript = useRecipes((s) => s.manuscript)
  const from = useRecipes((s) => s.from)
  const problem = useRecipes((s) => s.problem)
  const proposed = useRecipes((s) => s.proposed)
  const edits = useRecipes((s) => s.edits)
  const starting = useRecipes((s) => s.starting)
  const chapters = manuscript ? buildOutline(manuscript, proposed, edits).chapters.length : 0
  return (
    <PlanPage
      art="recipes"
      kicker="Story recipes"
      kickerIcon={CookingPot}
      title="Make a recipe"
      back={<BackButton to="library" />}
      line={
        manuscript
          ? 'Check how it splits into chapters: the AI reads it a chapter at a time. Merge any that belong together. Nothing is sent until you press Make the recipe.'
          : `Bring in a story you admire. The AI reads it chapter by chapter and writes down how it is made. ${INTRO}`
      }
      steps={{ steps: recipeSteps({ story: !!manuscript, chapters, making: starting }), icons: { bring: FileUp, check: FileText, make: BookOpenText } }}
      left={
        <>
          {problem ? <ProblemNotice message={problem.message} code={problem.code} /> : null}
          {manuscript ? (
            <Preview manuscript={manuscript} part="meta" />
          ) : (
            <div className="plan-group">
              <Segmented
                label="How the story comes in"
                value={from}
                onChange={setFrom}
                options={[
                  { value: 'file', label: 'From a file' },
                  { value: 'paste', label: 'Paste the text' }
                ]}
              />
              {from === 'file' ? <ChooseFile /> : <PasteBox />}
            </div>
          )}
        </>
      }
      right={
        manuscript ? (
          <section aria-label="The story’s chapters">
            <div className="plan-tray">
              <h2 className="plan-tray-t">Its chapters</h2>
              <span className="plan-count">
                <b>{chapters}</b> {chapters === 1 ? 'chapter' : 'chapters'}
              </span>
              <span className="text-[12.5px] text-muted">The AI reads one at a time. Merge any that belong together.</span>
            </div>
            <Preview manuscript={manuscript} part="list" />
          </section>
        ) : (
          <ResultsEmpty
            title="Its chapters will lie here"
            example={
              <>
                Chapters are found by their headings: <em>Chapter 12</em>, <em>Prologue</em>, or Word’s heading styles. You can merge any the split gets
                wrong before anything is sent.
              </>
            }
          >
            Choose a .docx, .md or .txt file, or paste the whole story. Nothing is sent to the AI until you press Make the recipe.
          </ResultsEmpty>
        )
      }
      foot={manuscript ? <MakeBar /> : null}
    />
  )
}
