// The Story builder's last step: what was built (the codex's pages, the outline kept), what is still open, and where
// to go next: the board, the codex, or the first scene to write. It says only what is true (2026-10-19: it said "Your
// story is built" even when nothing was): built in full, in part, or not yet, with the way to the step still to do.

import { useEffect, useState } from 'react'
import { Check, Feather, LayoutGrid, ListTree, Users } from '@/components/ui/icons'
import type { Outline, ID } from '@shared/types'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { useDesk } from '@/features/look/look'
import { helperKey, treeOf, useOutlineHelper } from '@/features/outline/helperStore'
import { countNodes, countLine, totalOf } from '@/features/outline/tree'
import { cn } from '@/lib/cn'
import { builderKey, useBuilders } from './store'
import { openStoryBuilder } from './StoryBuilderView'

export function DoneStep({ storyId }: { storyId: ID }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const outlineRev = useApp((s) => s.outlineRev)
  const b = useBuilders((s) => s.builders[builderKey(storyId)])!
  const run = useOutlineHelper((s) => s.sessions[helperKey(worldId, storyId)]?.run ?? null)
  const desk = useDesk()
  const [outline, setOutline] = useState<Outline | null>(null)
  useEffect(() => {
    void api.getOutline(storyId).then(setOutline).catch(() => setOutline(null))
  }, [storyId, outlineRev])
  const tree = run ? treeOf(run) : []
  const open = run ? countNodes(tree, run.decisions, 'open') : null
  const openCount = open ? open.acts + open.chapters + open.scenes : 0
  const firstScene = outline?.scenes[0]?.id ?? null
  const built = b.build?.words || (b.brief?.built ? 'your cast and world' : '')
  const recipe = b.brief?.recipe ? b.recipe?.name : null
  // The outline counts as done once something from it is kept (as the steps above say), or the story has more than the
  // empty first chapter and scene it was made with (kept before the app last opened).
  const kept = run ? totalOf(countNodes(tree, run.decisions, 'kept')) : 0
  const codexDone = !!built || !!b.brief?.built
  const outlineDone = kept > 0 || (!!outline && ((outline.acts?.length ?? 0) > 0 || outline.chapters.length > 1 || outline.scenes.length > 1))
  const whole = codexDone && outlineDone
  const headline = whole ? 'Your story is built' : codexDone ? 'Your cast and world are built' : outlineDone ? 'Your outline is in the story' : 'Nothing is built yet'
  const inStory = outline ? countLine({ acts: outline.acts?.length ?? 0, chapters: outline.chapters.length, scenes: outline.scenes.length }) : ''

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <div className={cn('rounded-xl border p-5', whole ? 'border-success/30 bg-success-soft' : 'border-line bg-surface')} data-done-summary>
        <p className="flex items-center gap-2 font-serif text-[18px] font-semibold text-fg">
          {whole ? <Check size={18} className="text-success" aria-hidden /> : null}
          {headline}
        </p>
        <ul className="mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-fg">
          <li>
            <span className="font-medium">Codex:</span> {built ? `built, with ${built}.` : codexDone ? 'built.' : 'not built yet.'}
          </li>
          <li>
            <span className="font-medium">Outline:</span>{' '}
            {outline ? (outlineDone ? `${inStory} in the story.` : 'nothing kept yet.') : '…'}
            {openCount && open ? ` ${countLine(open)} still waiting for a decision.` : ''}
          </li>
          {recipe ? (
            <li>
              <span className="font-medium">Recipe:</span> follows “{recipe}”.
            </li>
          ) : null}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        {firstScene ? (
          <Button variant="primary" icon={<Feather size={14} />} onClick={() => useApp.getState().selectScene(firstScene, storyId)}>
            Start writing
          </Button>
        ) : null}
        {desk ? (
          <Button icon={<LayoutGrid size={14} />} onClick={() => useApp.getState().navigate({ kind: 'board', storyId })}>
            Open the board
          </Button>
        ) : null}
        <Button icon={<Users size={14} />} onClick={() => useApp.getState().navigate({ kind: 'codex' })}>
          Open the codex
        </Button>
        {!codexDone ? (
          <Button variant="ghost" icon={<Users size={14} />} onClick={() => openStoryBuilder(storyId, 'codex')}>
            Build the cast and world
          </Button>
        ) : null}
        {openCount ? (
          <Button variant="ghost" onClick={() => openStoryBuilder(storyId, 'outline')}>
            Decide on the rest of the outline
          </Button>
        ) : !outlineDone ? (
          <Button variant="ghost" icon={<ListTree size={14} />} onClick={() => openStoryBuilder(storyId, 'outline')}>
            Plan the outline
          </Button>
        ) : null}
      </div>
      <p className="text-[12.5px] text-muted">You can come back here any time to plan more chapters, add to the cast, or change the story’s style.</p>
    </div>
  )
}
