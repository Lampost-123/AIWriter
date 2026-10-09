// Find and replace across the whole story (Writing by hand, Ctrl+Shift+F). Every match is listed by scene, with
// a little text around it in the prose font and a tick box (all ticked to start; a scene's box ticks all of its
// matches). Replace changes the ticked ones (storyReplace.ts); clicking a match's words opens its scene there,
// with the find bar. When the words are an entry's name, a box offers to rename it in memory too.
import * as D from '@radix-ui/react-dialog'
import { X } from '@/components/ui/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_LISTED, type StoryFindResult, type StorySceneMatches } from '@shared/contracts/find'
import { hasQuery } from '@shared/findReplace'
import type { EntryKind } from '@shared/types'
import { Button, Input, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useFind } from './findStore'
import { Toggle } from './FindBar'
import { pageNow, replaceInStory } from './storyReplace'

/** How an entry is named in "Also rename the character Mara…". */
const KIND_WORDS: Record<EntryKind, string> = {
  character: 'the character',
  place: 'the place',
  group: 'the group',
  item: 'the item',
  lore: 'the lore',
  event: 'the event',
  thread: 'the plot thread',
  glossary: 'the term'
}

const key = (sceneId: string, matchId: string): string => `${sceneId}|${matchId}`
const n = (x: number): string => x.toLocaleString()

/** "Chapter 2, scene 3". */
const placeWords = (s: StorySceneMatches): string => `Chapter ${s.chapterNumber}, scene ${s.sceneNumber}`

export function StoryFind(): React.JSX.Element {
  const open = useFind((s) => s.storyOpen)
  const query = useFind((s) => s.query)
  const replacement = useFind((s) => s.replacement)
  const matchCase = useFind((s) => s.matchCase)
  const wholeWord = useFind((s) => s.wholeWord)
  const focusTick = useFind((s) => s.focusTick)
  const set = useFind((s) => s.set)
  const storyId = useApp((s) => s.storyId)
  const storyTitle = useApp((s) => s.stories.find((x) => x.id === s.storyId)?.title ?? '')
  const outlineRev = useApp((s) => s.outlineRev)
  const [result, setResult] = useState<StoryFindResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set())
  const [rename, setRename] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)

  // Finds as Adam types (a moment after he stops), in the open scene as the page shows it.
  useEffect(() => {
    if (!open || !storyId) return
    if (!hasQuery(query)) {
      setResult(null)
      setLoading(false)
      setFailed(null)
      return
    }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      api
        .findInStory({ storyId, query, matchCase, wholeWord, page: pageNow()?.page ?? null })
        .then((r) => {
          if (!live) return
          setResult(r)
          setUnticked(new Set())
          setFailed(null)
        })
        .catch((e: Error) => live && setFailed(e.message))
        .finally(() => live && setLoading(false))
    }, 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [open, storyId, query, matchCase, wholeWord, outlineRev])

  // A spinner only when finding takes a while, so a quick one never flashes.
  useEffect(() => {
    if (!loading) return setSlow(false)
    const t = setTimeout(() => setSlow(true), 300)
    return () => clearTimeout(t)
  }, [loading])

  // Ctrl+Shift+F again while it shows: back to the find box.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      findRef.current?.focus()
      findRef.current?.select()
    })
  }, [open, focusTick])

  // Each time it opens, nothing is renamed unless Adam ticks it again.
  useEffect(() => {
    if (open) setRename(false)
  }, [open])

  const shown = hasQuery(query) ? result : null
  const ticked = useMemo(() => {
    if (!shown) return 0
    let c = 0
    for (const s of shown.scenes) for (const m of s.matches) if (!unticked.has(key(s.sceneId, m.id))) c++
    return c
  }, [shown, unticked])

  const renameTo = replacement.trim()
  const offer =
    shown?.rename && renameTo && renameTo !== shown.rename.name
      ? `Also rename ${KIND_WORDS[shown.rename.kind]} ${shown.rename.name} to ${renameTo} in memory (${shown.rename.name} stays as another name)`
      : null

  const toggleScene = (s: StorySceneMatches, on: boolean): void => {
    const next = new Set(unticked)
    for (const m of s.matches) (on ? next.delete(key(s.sceneId, m.id)) : next.add(key(s.sceneId, m.id)))
    setUnticked(next)
  }
  const toggleMatch = (k: string, on: boolean): void => {
    const next = new Set(unticked)
    if (on) next.delete(k)
    else next.add(k)
    setUnticked(next)
  }

  const openAt = (s: StorySceneMatches, index: number): void => {
    set({ storyOpen: false, sceneOpen: true, goTo: { sceneId: s.sceneId, index } })
    const app = useApp.getState()
    if (app.sceneId !== s.sceneId) app.selectScene(s.sceneId)
    else if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
  }

  const replace = async (): Promise<void> => {
    if (!shown || !storyId || !ticked || replacing) return
    setReplacing(true)
    try {
      const picks = shown.scenes
        .map((s) => ({ sceneId: s.sceneId, matchIds: s.matches.filter((m) => !unticked.has(key(s.sceneId, m.id))).map((m) => m.id) }))
        .filter((p) => p.matchIds.length)
      const res = await replaceInStory({
        storyId,
        query,
        matchCase,
        wholeWord,
        replacement,
        picks,
        rename: offer && rename && shown.rename ? { entryId: shown.rename.entryId, name: shown.rename.name } : null
      })
      if (res) {
        setResult(null)
        set({ storyOpen: false })
      }
    } catch (e) {
      setFailed((e as Error).message)
    } finally {
      setReplacing(false)
    }
  }

  const summary = !shown
    ? ''
    : shown.total === 0
      ? 'No matches in this story.'
      : `${n(shown.total)} ${shown.total === 1 ? 'match' : 'matches'} in ${shown.scenes.length === 1 ? 'one scene' : `${n(shown.scenes.length)} scenes`}.` +
        (shown.listed < shown.total ? ` The first ${n(MAX_LISTED)} are listed; find again after replacing them for the rest.` : '')
  const held = shown?.heldBack
    ? ` ${shown.heldBack === 1 ? 'One' : n(shown.heldBack)} inside the AI’s suggested change in the open scene ${shown.heldBack === 1 ? 'isn’t' : 'aren’t'} listed.`
    : ''

  return (
    <D.Root open={open} onOpenChange={(o) => set({ storyOpen: o })}>
      <D.Portal>
        {/* The New look: it appears at once (opened from the keyboard, Ctrl+Shift+F). */}
        <D.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in look-new:data-[state=open]:animate-none" />
        <D.Content
          data-find-story=""
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            findRef.current?.focus()
            findRef.current?.select()
          }}
          className="fixed left-1/2 top-[10vh] z-50 flex w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop focus:outline-none data-[state=open]:animate-pop-in look-new:data-[state=open]:animate-none"
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <D.Title className="text-[15px] font-semibold text-fg">Find and replace in the story</D.Title>
              <D.Description className="mt-0.5 truncate text-[13px] text-muted">{storyTitle ? `In “${storyTitle}”, every scene.` : 'Every scene of the story.'}</D.Description>
            </div>
            <D.Close className="rounded-md p-1 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2 px-5">
            <Input ref={findRef} value={query} onChange={(e) => set({ query: e.target.value })} placeholder="Find" aria-label="Find in the story" spellCheck={false} />
            <Input
              value={replacement}
              onChange={(e) => set({ replacement: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void replace()
                }
              }}
              placeholder="Replace with"
              aria-label="Replace with"
              spellCheck={false}
            />
          </div>
          <div className="flex h-9 items-center gap-1 px-5">
            <Toggle on={matchCase} onChange={(v) => set({ matchCase: v })}>
              Match case
            </Toggle>
            <Toggle on={wholeWord} onChange={(v) => set({ wholeWord: v })}>
              Whole word
            </Toggle>
            <span className="ml-auto flex w-4 justify-center text-faint">{slow ? <Spinner size={14} /> : null}</span>
          </div>
          <div className="h-[min(400px,48vh)] overflow-y-auto overscroll-contain border-y border-line bg-page px-2 py-1.5" role="list" aria-label="Matches">
            {failed ? (
              <p className="px-3 py-3 text-[13px] text-muted">{failed}</p>
            ) : !shown ? (
              <p className="px-3 py-3 text-[13px] text-faint">{hasQuery(query) ? '' : 'Type the words to find. Every scene of the story is looked through.'}</p>
            ) : shown.total === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <p className="text-[14px] font-medium text-fg">Nothing matches “{query.trim()}”</p>
                <p className="mt-1 text-[13px] text-muted">Check the spelling, or turn off Match case or Whole word.</p>
              </div>
            ) : (
              shown.scenes.map((s) => (
                <SceneGroup key={s.sceneId} scene={s} unticked={unticked} onScene={toggleScene} onMatch={toggleMatch} onOpen={openAt} />
              ))
            )}
          </div>
          <div className="px-5 pb-4 pt-3">
            <p className="min-h-[18px] text-[12.5px] text-muted" aria-live="polite">
              {summary}
              {held}
            </p>
            {offer ? (
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-[13px] text-fg">
                <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-accent" />
                <span>{offer}</span>
              </label>
            ) : null}
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => set({ storyOpen: false })}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!ticked} loading={replacing} onClick={() => void replace()}>
                {!shown || !ticked ? 'Replace' : ticked === shown.listed ? `Replace all ${n(ticked)}` : `Replace ${n(ticked)} of ${n(shown.listed)}`}
              </Button>
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function SceneGroup({
  scene,
  unticked,
  onScene,
  onMatch,
  onOpen
}: {
  scene: StorySceneMatches
  unticked: Set<string>
  onScene: (s: StorySceneMatches, on: boolean) => void
  onMatch: (k: string, on: boolean) => void
  onOpen: (s: StorySceneMatches, index: number) => void
}): React.JSX.Element {
  const on = scene.matches.filter((m) => !unticked.has(key(scene.sceneId, m.id))).length
  const boxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = on > 0 && on < scene.matches.length
  }, [on, scene.matches.length])
  return (
    <div role="listitem" className="pb-1 [content-visibility:auto] [contain-intrinsic-size:auto_96px]">
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 pb-1 pt-2 hover:bg-surface-2" title={scene.chapterTitle}>
        <input
          ref={boxRef}
          type="checkbox"
          checked={on === scene.matches.length}
          onChange={(e) => onScene(scene, e.target.checked)}
          aria-label={`${scene.sceneTitle}: all its matches`}
          className="h-3.5 w-3.5 shrink-0 accent-accent"
        />
        {/* A scene still called "Scene 2" is named by where it is alone. */}
        {/^Scene \d+$/.test(scene.sceneTitle.trim()) ? (
          <span className="min-w-0 truncate text-[13px] font-medium text-fg">{placeWords(scene)}</span>
        ) : (
          <>
            <span className="min-w-0 truncate text-[13px] font-medium text-fg">{scene.sceneTitle}</span>
            <span className="shrink-0 text-[12px] text-faint">{placeWords(scene)}</span>
          </>
        )}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-faint">{n(scene.matches.length)}</span>
      </label>
      <ul className="pl-6">
        {scene.matches.map((m, i) => {
          const k = key(scene.sceneId, m.id)
          return (
            <li key={m.id} className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={!unticked.has(k)}
                onChange={(e) => onMatch(k, e.target.checked)}
                aria-label={`Replace “${m.text}” here`}
                className="mt-[5px] h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <button
                type="button"
                onClick={() => onOpen(scene, i)}
                title="Open the scene here"
                className={cn('min-w-0 flex-1 text-left font-serif text-[14px] leading-snug text-muted', unticked.has(k) && 'opacity-60')}
              >
                {m.before}
                <mark className="rounded-[3px] bg-accent-soft px-px text-fg">{m.text}</mark>
                {m.after}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
