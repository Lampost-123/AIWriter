// The Consistency page's Issues tab: every open issue in the story, story-wide ones first, then by
// chapter and scene in story order, must-fix first in each. Clicking an issue opens its scene at the
// words, with the scene panel on its Issues tab; Ignore is undoable from its toast.
import { CircleCheck, EyeOff, RotateCcw, SearchCheck } from '@/components/ui/icons'
import { useState } from 'react'
import type { Issue, IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { Badge, Button, EmptyState, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { ViewError, ViewLoading } from '@/features/timeline/viewParts'
import { issueSummary, KIND_WORDS, SEVERITY_WORDS, type IssueGroups } from './consistencyLogic'
import { openEntry, openIssue, openThread } from './open'

export function IssuesTab({
  storyId,
  groups,
  error,
  onRetry,
  storyScenes,
  showIgnored,
  onShowIgnored,
  onChanged
}: {
  storyId: ID
  groups: IssueGroups | null
  /** The story's scenes, which an issue's links can open. */
  storyScenes: Set<ID>
  error: string | null
  onRetry: () => void
  showIgnored: boolean
  onShowIgnored: (on: boolean) => void
  /** An issue ignored or reopened here, to show at once. */
  onChanged: (issue: Issue) => void
}): React.JSX.Element {
  if (!groups) return error ? <ViewError what="The issues" error={error} onRetry={onRetry} /> : <ViewLoading />
  const nothing = !groups.story.length && !groups.chapters.length

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-12 pt-4">
      {/* With nothing open, the empty state below says so (once), and the page's own Check this story is the way to look. */}
      <div className={cn('mb-3 flex min-h-8 items-center gap-3', nothing && !groups.ignored && 'hidden')}>
        <p className="flex-1 text-[13px] text-muted">{nothing ? null : issueSummary(groups)}</p>
        {groups.ignored ? (
          <label className="flex cursor-default items-center gap-2 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => onShowIgnored(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Show ignored ({groups.ignored})
          </label>
        ) : null}
      </div>
      {nothing ? (
        <EmptyState
          art="clear"
          icon={groups.ignored ? <CircleCheck size={20} /> : <SearchCheck size={20} />}
          title={groups.ignored ? 'Nothing left to look at' : 'No issues found'}
          className="mt-[4vh]"
        >
          Scenes are checked against the memory when you mark them done. Check the whole story to look for facts, knowledge and
          timeline that disagree. Anything found shows here, by chapter and scene.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.story.length ? (
            <section aria-label="The whole story">
              <GroupHeading title="The whole story" />
              <IssueList issues={groups.story} storyId={storyId} storyScenes={storyScenes} onChanged={onChanged} />
            </section>
          ) : null}
          {groups.chapters.map((c) => (
            <section key={c.chapterId} aria-label={c.title ? `${c.label}: ${c.title}` : c.label}>
              <GroupHeading title={c.label} sub={c.title} />
              <div className="flex flex-col gap-4">
                {c.scenes.map((s) => (
                  <div key={s.sceneId}>
                    <h3 className="mb-1.5 px-1 text-[12.5px] font-medium text-muted">
                      {s.label}
                      {s.title ? <span className="font-normal text-faint"> · {s.title}</span> : null}
                    </h3>
                    <IssueList issues={s.issues} storyId={storyId} storyScenes={storyScenes} onChanged={onChanged} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupHeading({ title, sub }: { title: string; sub?: string }): React.JSX.Element {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2 px-1 text-[14px] font-semibold text-fg">
      {title}
      {sub ? <span className="min-w-0 truncate text-[13px] font-normal text-muted">{sub}</span> : null}
    </h2>
  )
}

interface ListProps {
  storyId: ID
  storyScenes: Set<ID>
  onChanged: (i: Issue) => void
}

function IssueList({ issues, ...rest }: ListProps & { issues: Issue[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((i) => (
        <li key={i.id}>
          <IssueCard issue={i} {...rest} />
        </li>
      ))}
    </ul>
  )
}

/** Marks an issue as intended, with Undo in its toast. */
async function ignore(issue: Issue, onChanged: (i: Issue) => void): Promise<void> {
  onChanged({ ...issue, status: 'ignored' })
  try {
    onChanged(await api.ignoreIssue(issue.id))
    toast('Issue ignored. It won’t be raised again.', { action: { label: 'Undo', run: () => void reopen(issue, onChanged) } })
  } catch (e) {
    onChanged(issue)
    toast(`Couldn’t ignore that issue. ${plainReason(e)}`, { tone: 'danger' })
  }
}

async function reopen(issue: Issue, onChanged: (i: Issue) => void): Promise<void> {
  onChanged({ ...issue, status: 'open' })
  try {
    onChanged(await api.reopenIssue(issue.id))
  } catch (e) {
    onChanged({ ...issue, status: 'ignored' })
    toast(`Couldn’t bring that issue back. ${plainReason(e)}`, { tone: 'danger' })
  }
}

function IssueCard({ issue: i, storyId, storyScenes, onChanged }: ListProps & { issue: Issue }): React.JSX.Element {
  const ignored = i.status === 'ignored'
  const opens = !!i.sceneId
  const [busy, setBusy] = useState(false)
  const act = (fn: () => Promise<void>): void => {
    setBusy(true)
    void fn().finally(() => setBusy(false))
  }
  return (
    // The whole card opens the scene for the mouse; the message is the button for the keyboard.
    <div
      data-issue={i.id}
      onClick={(e) => {
        if (opens && !(e.target as HTMLElement).closest('button, a')) openIssue(i, storyId)
      }}
      className={cn(
        'group rounded-xl border bg-surface px-4 py-3 shadow-soft transition-colors duration-150',
        opens && 'cursor-pointer hover:border-line-strong',
        i.severity === 'must-fix' && !ignored ? 'border-danger/35' : 'border-line',
        ignored && 'opacity-70'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {i.severity === 'must-fix' ? (
              <Badge tone="danger">{SEVERITY_WORDS[i.severity]}</Badge>
            ) : i.severity === 'warning' ? (
              <Badge>{SEVERITY_WORDS[i.severity]}</Badge>
            ) : (
              <span className="font-medium text-faint">{SEVERITY_WORDS[i.severity]}</span>
            )}
            <span className="text-faint">{KIND_WORDS[i.kind] ?? ''}</span>
            {ignored ? <span className="text-faint">· Ignored</span> : null}
          </div>
          {opens ? (
            <button
              type="button"
              onClick={() => openIssue(i, storyId)}
              title="Open the scene at these words"
              className="block w-full rounded text-left text-[13.5px] leading-relaxed text-fg outline-none group-hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {i.message}
            </button>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-fg">{i.message}</p>
          )}
          {i.quote ? <blockquote className="mt-1.5 border-l-2 border-line pl-3 font-serif text-[13.5px] italic text-muted">{i.quote}</blockquote> : null}
          {i.sources.length ? <Sources sources={i.sources} storyId={storyId} storyScenes={storyScenes} /> : null}
        </div>
        {ignored ? (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} loading={busy} onClick={() => act(() => reopen(i, onChanged))}>
            Reopen
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} loading={busy} onClick={() => act(() => ignore(i, onChanged))}>
            Ignore
          </Button>
        )}
      </div>
    </div>
  )
}

/** "Disagrees with Mara (eyes), Book 1, Ch 2, Sc 1", each a link where it can be opened (scenes of this story). */
function Sources({ sources, storyId, storyScenes }: { sources: IssueSource[]; storyId: ID; storyScenes: Set<ID> }): React.JSX.Element {
  const link = 'rounded font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40'
  return (
    <p className="mt-2 text-[12.5px] text-muted">
      Disagrees with{' '}
      {sources.map((s, n) => (
        <span key={n}>
          {n ? ', ' : ''}
          {s.kind === 'entry' ? (
            <button type="button" className={link} onClick={() => void openEntry(s.entryId)}>
              {s.field ? `${s.name} (${s.field})` : s.name}
            </button>
          ) : s.kind === 'thread' ? (
            <button type="button" className={link} onClick={() => openThread(s.entryId)}>
              {s.name}
            </button>
          ) : s.kind === 'scene' && storyScenes.has(s.sceneId) ? (
            <button type="button" className={link} onClick={() => useApp.getState().selectScene(s.sceneId, storyId)}>
              {s.label}
            </button>
          ) : s.kind === 'scene' ? (
            s.label
          ) : (
            s.title
          )}
        </span>
      ))}
    </p>
  )
}
