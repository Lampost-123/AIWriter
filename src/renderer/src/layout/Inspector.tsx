import { useEffect, useRef } from 'react'
import { AudioLines } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { Tabs, TabsContent, TabsList } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp, type InspectorTab } from '@/lib/store'
import { SceneCardPanel } from '@/features/inspector/SceneCardPanel'
import { ContextPanel } from '@/features/context/ContextPanel'
import { CastPanel } from '@/features/cast/CastPanel'
import { GenerationsPanel } from '@/features/generate/GenerationsPanel'
import { PeekPanel } from '@/features/peek/PeekPanel'
import { AskPanel } from '@/features/ask/AskPanel'
import { IssuesPanel, IssuesTabCount } from '@/features/issues/IssuesPanel'
import { SoundsPanel } from '@/features/sounds/SoundsPanel'
import { ChapterCardPanel } from '@/features/chapterCard/ChapterCardPanel'
import { CritiqueLabel, CritiquePanel } from '@/features/critique/CritiquePanel'

const TAB_LABELS: Record<InspectorTab, string> = {
  card: 'Scene card',
  context: 'Context',
  cast: 'Cast',
  issues: 'Issues',
  critique: 'Critique',
  drafts: 'Drafts',
  sounds: 'Sounds'
}
const TABS: InspectorTab[] = ['card', 'context', 'cast', 'issues', 'critique', 'drafts']
/** With sound effects on, the Sounds tab comes last. */
const TABS_WITH_SOUNDS: InspectorTab[] = [...TABS, 'sounds']

/** "Scene card", or "Card" when the panel is narrow (a screen reader still hears "Scene card"). */
function CardLabel(): React.JSX.Element {
  return (
    <>
      <span className="@max-[329px]:sr-only">Scene card</span>
      <span aria-hidden className="@min-[330px]:hidden">
        Card
      </span>
    </>
  )
}

/** "Sounds", or a speaker when the panel is narrow (a screen reader still hears "Sounds"). */
function SoundsLabel(): React.JSX.Element {
  return (
    <>
      <span className="@max-[395px]:sr-only">Sounds</span>
      <span aria-hidden title="Sounds" className="@min-[396px]:hidden">
        <AudioLines size={15} />
      </span>
    </>
  )
}

/**
 * The right-hand panel beside a scene: its card, the briefing a draft would get, who is in it, and
 * its drafts. An entry shown beside the page (Ctrl+click on a name, or the Cast tab) takes the
 * panel's place until Back; the tabs stay as they were underneath. Ask the world (milestone 4) takes it
 * the same way while it is open.
 */
export function Inspector({ sceneId }: { sceneId: ID }): React.JSX.Element {
  // Kept in the store, so coming back from "What the AI saw" shows the Drafts tab again.
  const stored = useApp((s) => s.inspectorTab)
  // The Sounds tab shows while sound effects are on (they play under Read aloud); off, its place falls back to the card.
  const sounds = useApp((s) => !!s.settings?.speech.readAloud && !!s.settings?.speech.soundEffects)
  const tab: InspectorTab = stored === 'sounds' && !sounds ? 'card' : stored
  const tabs = sounds ? TABS_WITH_SOUNDS : TABS
  const setTab = useApp((s) => s.setInspectorTab)
  const peekId = useApp((s) => s.peekEntryId)
  const askOpen = useApp((s) => s.askOpen)
  const chapterCardId = useApp((s) => s.chapterCardId)
  const rootRef = useRef<HTMLDivElement>(null)

  const back = (): void => {
    const wasInside = !!rootRef.current?.contains(document.activeElement)
    useApp.getState().peekEntry(null)
    useApp.getState().openChapterCard(null)
    // From the panel's own Back, the keyboard carries on from the tab it returns to.
    if (wasInside) requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus())
  }

  // When something else picks a tab while an entry or a chapter card shows here, the tab shows instead.
  const lastTab = useRef(tab)
  useEffect(() => {
    if (lastTab.current === tab) return
    lastTab.current = tab
    if (useApp.getState().peekEntryId) useApp.getState().peekEntry(null)
    if (useApp.getState().chapterCardId) useApp.getState().openChapterCard(null)
  }, [tab])

  const chapterShown = !!chapterCardId && !askOpen && !peekId
  return (
    <div ref={rootRef} className="@container h-full min-h-0">
      {askOpen ? <AskPanel sceneId={sceneId} onClose={() => useApp.getState().setAskOpen(false)} /> : null}
      {peekId && !askOpen ? <PeekPanel sceneId={sceneId} entryId={peekId} backLabel={TAB_LABELS[tab]} onBack={back} /> : null}
      {chapterShown ? <ChapterCardPanel chapterId={chapterCardId} closeLabel={TAB_LABELS[tab]} onClose={back} /> : null}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as InspectorTab)}
        // Hidden, not unmounted, while an entry or a chapter card shows, so Back finds the tab as it was.
        className={cn('h-full min-h-0 flex-col', peekId || askOpen || chapterShown ? 'hidden' : 'flex')}
      >
        <TabsList
          tall
          // Six tabs fit the panel at its narrowest (260 px): a little less room around each, no gap below 300 px, "Card"
          // for "Scene card" (still read out in full) below 330 px, and a speech mark for "Critique" below 360 px. The
          // Issues tab's count sits over its corner. With the Sounds tab (seven), a speaker stands for "Sounds" below 396 px
          // and the speech mark for "Critique" below 460 px, and the tabs sit a little closer: below 300 px with no gap and
          // little room around each, and from 380 px with less room around each until 440 px. The New look's tabs have
          // more room around them, so it gives them less too below 440 px.
          className={
            sounds
              ? 'px-1! *:px-1 @max-[299px]:gap-0! @max-[299px]:*:px-0.5 @min-[300px]:*:px-1.5 @min-[380px]:px-2! @min-[380px]:*:px-2 @min-[440px]:*:px-2.5 @max-[299px]:look-new:*:px-0.5! @min-[300px]:@max-[439px]:look-new:*:px-1.5!'
              : 'px-1! *:px-1 @max-[299px]:gap-0! @min-[300px]:*:px-1.5 @min-[380px]:px-2! @min-[380px]:*:px-2.5 @max-[299px]:look-new:*:px-1! @min-[300px]:@max-[439px]:look-new:*:px-1.5!'
          }
          items={tabs.map((value) => ({
            value,
            label:
              value === 'card' ? (
                <CardLabel />
              ) : value === 'sounds' ? (
                <SoundsLabel />
              ) : value === 'critique' ? (
                <CritiqueLabel crowded={sounds} />
              ) : (
                TAB_LABELS[value]
              ),
            badge: value === 'issues' ? <IssuesTabCount sceneId={sceneId} /> : undefined
          }))}
        />
        <TabsContent value="card" className="overflow-auto">
          <SceneCardPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="context" className="overflow-auto">
          <ContextPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="cast" className="overflow-auto">
          <CastPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="issues" className="overflow-auto">
          <IssuesPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="critique" className="overflow-auto">
          <CritiquePanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        <TabsContent value="drafts" className="overflow-auto">
          <GenerationsPanel key={sceneId} sceneId={sceneId} />
        </TabsContent>
        {sounds ? (
          <TabsContent value="sounds" className="overflow-auto">
            <SoundsPanel key={sceneId} sceneId={sceneId} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
