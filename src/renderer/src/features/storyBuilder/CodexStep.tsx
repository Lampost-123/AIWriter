// Build with AI's Cast and world (the Story builder's second step before, 2026-10-20). The AI plans everything the story
// needs from the idea (and its recipe): characters (with the recipe role each plays), places, groups, items, lore,
// events, plot threads and glossary words. Adam's own are marked; what the world has already is marked too (the build
// adds to that page). Each can be unticked, edited, redone with a note or taken off; the whole list can be talked over
// (CodexTalk, beside the area). Then "Build it" lays out every ticked one in full with the World builder, live on the
// page, and one Undo takes the build back.

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Plus, RotateCcw, Sparkles, Square, Trash2, Undo2, Users, WandSparkles } from '@/components/ui/icons'
import type { CodexItem } from '@shared/contracts/storyBuilder'
import type { EntryKind, ID } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { Button, Input, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from '@/features/planning/LampThinking'
import { TalkPanel } from '@/features/planning/TalkPanel'
import { settlePreview, useTalks } from '@/features/planning/talkStore'
import {
  addItem,
  applyCodexTalk,
  buildCodex,
  builderKey,
  closeItemRedo,
  codexScope,
  dismissCodexError,
  openItemRedo,
  patchBrief,
  patchItem,
  patchItemRedo,
  planCodex,
  redoItem,
  removeItem,
  stopBuild,
  stopCodex,
  takeItemRedo,
  talkCodex,
  tickAll,
  undoCodexBuild,
  useBuilders
} from './store'

const ORDER: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event', 'thread', 'glossary']

export interface CodexStepProps {
  storyId: ID
  /** Goes to another section of Build with AI (Your idea, the story line). */
  onGo: (section: 'idea' | 'line') => void
  /** Shows "From a summary" in place of this. */
  onSummary: () => void
  /** The story's premise: the idea while there is no plot (Your idea shows it in the idea field). */
  premise?: string
}

export function CodexStep({ storyId, onGo, onSummary, premise = '' }: CodexStepProps): React.JSX.Element {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])!
  const brief = b.brief!
  const items = brief.codex
  const planning = !!b.codexTask
  const build = b.build
  const building = build?.status === 'running'
  const built = !!brief.built || build?.status === 'complete'
  const ticked = (items ?? []).filter((it) => it.on && it.name.trim()).length
  const noIdea = !brief.plot.trim() && !brief.mine.length && !premise.trim()
  // The premise stands for the idea while there is no plot: it becomes the plot the AI plans from.
  const plan = (): void => {
    if (!brief.plot.trim() && premise.trim()) patchBrief(storyId, { plot: premise })
    void planCodex(storyId)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {planning ? (
            <>
              <LampStatus text="Planning the cast and world…" />
              <Button icon={<Square size={11} fill="currentColor" />} onClick={() => stopCodex(storyId)}>
                Stop
              </Button>
            </>
          ) : (
            <Button variant={items ? 'secondary' : 'ai'} size={items ? 'md' : 'lg'} icon={<Sparkles size={15} />} disabled={noIdea || building} onClick={plan} data-plan-codex>
              {items ? 'Plan it again' : 'Plan the cast and world'}
            </Button>
          )}
          {noIdea ? (
            <span className="text-[12.5px] text-faint">
              Write your idea first, in{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => onGo('idea')}>
                Your idea
              </button>
              .
            </span>
          ) : null}
        </div>
        {b.codexError ? (
          <Notice tone="danger" action={<Button size="sm" variant="ghost" onClick={() => dismissCodexError(storyId)}>OK</Button>}>
            {b.codexError}
          </Notice>
        ) : null}
        {!items ? (
          <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
            <Users size={22} className="mx-auto text-faint" aria-hidden />
            <p className="mt-2 font-serif text-[16px] text-fg">Everything your story needs, planned before it’s built</p>
            <p className="mx-auto mt-1 max-w-[460px] text-[13px] leading-relaxed text-muted">
              The AI lists the characters, places, groups, objects, lore, events, plot threads and words your story needs, building on your idea.
              Tick what you want, change anything, then build it all into your codex.
            </p>
            <button type="button" className="mt-3 text-[12px] text-muted hover:text-fg hover:underline" onClick={onSummary}>
              Or build it from a summary you write
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4" data-codex-list>
              {ORDER.map((kind) => (
                <KindGroup key={kind} storyId={storyId} kind={kind} items={items.filter((it) => it.kind === kind)} locked={building} />
              ))}
            </div>
            <BuildBar storyId={storyId} ticked={ticked} built={built} />
          </>
        )}
      </div>
      {build || built ? <BuildStatus storyId={storyId} onNext={() => onGo('line')} /> : null}
    </div>
  )
}

/** Whether the cast and world list can be talked over now (the talk beside the area says why not). */
export function useCodexLocked(storyId: ID): boolean {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])
  return !!b?.codexTask || b?.build?.status === 'running'
}

function KindGroup({ storyId, kind, items, locked }: { storyId: ID; kind: EntryKind; items: CodexItem[]; locked: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const on = items.filter((it) => it.on).length
  if (!items.length && kind !== 'character' && kind !== 'place') return null
  return (
    <section aria-label={KIND_LABELS[kind].many} className="rounded-xl border border-line bg-surface" data-kind={kind}>
      <header className="flex items-center gap-2 px-3.5 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={13} className={cn('text-faint transition-transform duration-150', !open && '-rotate-90')} aria-hidden />
          <h3 className="text-[13px] font-semibold text-fg">{KIND_LABELS[kind].many}</h3>
          <span className="text-[12px] tabular-nums text-faint">
            {on} of {items.length}
          </span>
        </button>
        {items.length && !locked ? (
          <button type="button" className="text-[12px] text-muted hover:text-fg" onClick={() => tickAll(storyId, kind, on < items.length)}>
            {on < items.length ? 'Tick all' : 'Untick all'}
          </button>
        ) : null}
        {!locked ? (
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => addItem(storyId, kind)} aria-label={`Add a ${KIND_LABELS[kind].one.toLowerCase()}`}>
            Add
          </Button>
        ) : null}
      </header>
      {open && items.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((it) => (
            <ItemRow key={it.key} storyId={storyId} item={it} locked={locked} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ItemRow({ storyId, item, locked }: { storyId: ID; item: CodexItem; locked: boolean }): React.JSX.Element {
  const redo = useBuilders((s) => s.builders[builderKey(storyId)]?.redos[item.key])
  const [editing, setEditing] = useState(!item.name)
  const extra = [item.role ? `Plays: ${item.role}` : '', item.in ? `Inside ${item.in}` : '', item.when ? `When: ${item.when}` : '', item.rule ? 'Always true' : ''].filter(Boolean)
  return (
    <li className={cn('px-3.5 py-2.5', !item.on && 'opacity-60')} data-item={item.key}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          checked={item.on}
          disabled={locked}
          aria-label={`Build ${item.name || 'this'}`}
          onChange={(e) => patchItem(storyId, item.key, { on: e.target.checked })}
        />
        <div className="min-w-0 flex-1">
          {editing && !locked ? (
            <div className="flex flex-col gap-1.5">
              <Input aria-label="Name" value={item.name} autoFocus placeholder="Name" onChange={(e) => patchItem(storyId, item.key, { name: e.target.value })} />
              <AutoTextarea aria-label="About" value={item.about} minRows={2} maxRows={8} placeholder="Who or what it is" onChange={(e) => patchItem(storyId, item.key, { about: e.target.value })} />
              {item.kind === 'event' ? <Input aria-label="When" value={item.when} placeholder="When: Day 3, or “twenty years before”" onChange={(e) => patchItem(storyId, item.key, { when: e.target.value })} /> : null}
              {item.kind === 'character' ? <Input aria-label="Role" value={item.role} placeholder="The part they play (optional)" onChange={(e) => patchItem(storyId, item.key, { role: e.target.value })} /> : null}
              <div>
                <Button size="sm" variant="ghost" icon={<Check size={12} />} onClick={() => setEditing(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-serif text-[14.5px] font-semibold text-fg">{item.name || 'Unnamed'}</span>
                {item.mine ? <span className="rounded bg-accent/10 px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">Yours</span> : null}
                {item.existing ? (
                  <span className="rounded bg-line/60 px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted" title={`Already in your world as ${item.existing.name}: the build adds to that page`}>
                    In your world
                  </span>
                ) : null}
              </p>
              {item.about ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{item.about}</p> : null}
              {extra.length ? <p className="mt-0.5 text-[11.5px] text-faint">{extra.join(' · ')}</p> : null}
            </>
          )}
        </div>
        {!locked && !editing ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-line/50 hover:text-fg" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-ai/10 hover:text-fg" onClick={() => (redo ? closeItemRedo(storyId, item.key) : openItemRedo(storyId, item.key))} data-item-redo>
              Redo
            </button>
            <button type="button" className="rounded p-1 text-faint hover:bg-line/50 hover:text-fg" aria-label={`Take ${item.name || 'this'} off the list`} onClick={() => removeItem(storyId, item.key)}>
              <Trash2 size={12} />
            </button>
          </div>
        ) : null}
      </div>
      {redo ? <ItemRedoPanel storyId={storyId} item={item} /> : null}
    </li>
  )
}

function ItemRedoPanel({ storyId, item }: { storyId: ID; item: CodexItem }): React.JSX.Element | null {
  const r = useBuilders((s) => s.builders[builderKey(storyId)]?.redos[item.key])
  if (!r) return null
  return (
    <div className="ml-6 mt-2 rounded-lg border border-ai/40 bg-bg p-3 animate-fade-in">
      {!r.item ? (
        <>
          <AutoTextarea
            aria-label="What should be different"
            value={r.note}
            minRows={1}
            maxRows={4}
            autoFocus
            disabled={!!r.taskId}
            placeholder={item.mine ? 'What should be different? (Your name for them stays.)' : 'What should be different? Leave empty for a fresh take.'}
            className="text-[13px]"
            onChange={(e) => patchItemRedo(storyId, item.key, { note: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !r.taskId) {
                e.preventDefault()
                void redoItem(storyId, item.key)
              } else if (e.key === 'Escape') closeItemRedo(storyId, item.key)
            }}
          />
          {r.error ? (
            <div className="mt-2">
              <Notice tone="danger">{r.error}</Notice>
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            {r.taskId ? (
              <>
                <LampStatus text="Writing it again…" />
                <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => closeItemRedo(storyId, item.key)}>
                  Stop
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => closeItemRedo(storyId, item.key)}>
                  Cancel
                </Button>
                <Button size="sm" variant="ai" icon={<RotateCcw size={13} />} onClick={() => void redoItem(storyId, item.key)}>
                  Write it again
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="font-serif text-[14px] font-semibold text-fg">{r.item.name}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{r.item.about}</p>
          {r.item.role || r.item.when ? <p className="mt-0.5 text-[11.5px] text-faint">{[r.item.role ? `Plays: ${r.item.role}` : '', r.item.when ? `When: ${r.item.when}` : ''].filter(Boolean).join(' · ')}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => closeItemRedo(storyId, item.key)}>
              Keep mine
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => {
              patchItemRedo(storyId, item.key, { item: null })
              void redoItem(storyId, item.key)
            }}>
              Again
            </Button>
            <Button size="sm" variant="primary" onClick={() => takeItemRedo(storyId, item.key)}>
              Use this
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function CodexPreview({ items, before }: { items: CodexItem[]; before: CodexItem[] }): React.JSX.Element {
  const marks = useMemo(() => {
    const out = new Map<string, 'new' | 'changed'>()
    for (const it of items) {
      const was = before.find((x) => x.key === it.key)
      if (!was) out.set(it.key, 'new')
      else if (was.name !== it.name || was.about !== it.about || was.role !== it.role || was.when !== it.when) out.set(it.key, 'changed')
    }
    return out
  }, [items, before])
  const gone = before.filter((x) => !items.some((it) => it.key === x.key))
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        {marks.size || gone.length ? `${marks.size} new or changed${gone.length ? `, ${gone.length} taken off` : ''}.` : 'No changes to the list.'} Apply puts this list in place; Undo brings
        the old one back.
      </p>
      <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
        {items
          .filter((it) => marks.has(it.key))
          .map((it) => (
            <li key={it.key} className="rounded-md bg-ai-soft px-2 py-1.5">
              <p className="text-[12.5px]">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{KIND_LABELS[it.kind].one}</span>{' '}
                <span className="font-semibold text-fg">{it.name}</span> <span className="text-[11px] text-ai">{marks.get(it.key) === 'new' ? 'New' : 'Changed'}</span>
              </p>
              {it.about ? <p className="text-[12px] text-muted">{it.about}</p> : null}
            </li>
          ))}
        {gone.map((it) => (
          <li key={it.key} className="px-2 py-1 text-[12px] text-faint line-through">
            {KIND_LABELS[it.kind].one}: {it.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Talking the cast and world list over (beside Build with AI while Cast and world is in view). */
export function CodexTalk({ storyId, locked, className, title = 'Talk the cast and world over', about }: { storyId: ID; locked: boolean; className?: string; title?: string; about?: string }): React.JSX.Element {
  const scope = codexScope(storyId)
  const preview = useTalks((s) => s.talks[scope]?.preview) as CodexItem[] | null | undefined
  const before = useBuilders((s) => s.builders[builderKey(storyId)]?.brief?.codex) ?? []
  return (
    <TalkPanel
      scope={scope}
      title={title}
      about={about}
      className={className}
      intro="Tell the AI what to change: “make the villain her brother”, “add a rival smuggler crew”, “fewer side characters”. You see the new list first."
      placeholder="What would you like changed?"
      quick={['Add a strong antagonist', 'Give the lead a family', 'More places to explore', 'Add secrets and plot threads']}
      disabled={locked ? 'Wait for the AI to finish first.' : null}
      onSay={(m) => void talkCodex(storyId, m)}
      preview={preview ? <CodexPreview items={preview} before={before} /> : null}
      onApply={() => applyCodexTalk(storyId)}
      onDecline={() => settlePreview(scope, 'declined')}
    />
  )
}

function BuildBar({ storyId, ticked, built }: { storyId: ID; ticked: number; built: boolean }): React.JSX.Element {
  const build = useBuilders((s) => s.builders[builderKey(storyId)]?.build)
  const running = build?.status === 'running'
  return (
    <div className="sticky bottom-0 z-10 -mx-2 flex items-center gap-3 rounded-xl border border-line bg-bg/95 px-4 py-3 backdrop-blur-sm" data-build-bar>
      <p className="min-w-0 flex-1 text-[12.5px] text-muted">
        {running
          ? 'Building your codex: full profiles, places, links and relationships…'
          : built
            ? 'Built. Build again to add what you have ticked since; nothing already made is made twice.'
            : `${ticked} ticked. Building writes a full page for each in your codex.`}
      </p>
      {running ? (
        <Button icon={<Square size={11} fill="currentColor" />} onClick={() => stopBuild(storyId)}>
          Stop
        </Button>
      ) : (
        <Button variant="primary" icon={<WandSparkles size={14} />} disabled={!ticked} onClick={() => void buildCodex(storyId)} data-build>
          {built ? 'Build again' : `Build ${ticked} into the codex`}
        </Button>
      )}
    </div>
  )
}

function BuildStatus({ storyId, onNext }: { storyId: ID; onNext: () => void }): React.JSX.Element {
  const b = useBuilders((s) => s.builders[builderKey(storyId)])!
  const build = b.build
  const running = build?.status === 'running'
  return (
    <section aria-label="Building" className="rounded-xl border border-line bg-surface p-4" data-build-status>
      <h2 className="text-[13px] font-semibold text-fg">Your codex</h2>
      {running ? (
        <div className="mt-2">
          <LampStatus text={build.step || 'Building…'} />
          <p className="mt-1 text-[12.5px] text-muted">{build.made ? `${build.made} made so far.` : 'Starting.'} You can leave this page: it carries on.</p>
        </div>
      ) : build?.status === 'error' ? (
        <div className="mt-2">
          <Notice tone="danger">{build.error ?? 'The build stopped. Try building again.'}</Notice>
        </div>
      ) : (
        <div className="mt-2">
          <p className="flex items-center gap-1.5 text-[13px] text-fg">
            <Check size={14} className="text-success" aria-hidden />
            {build?.words ? `Built: ${build.words}.` : build?.status === 'cancelled' ? 'Stopped. What was made so far stays.' : 'Built into your codex.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => useApp.getState().navigate({ kind: 'codex' })}>
              Open the codex
            </Button>
            <Button size="sm" variant="primary" onClick={onNext}>
              Next: the story line
            </Button>
            {build?.runId || b.brief?.built?.runId ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => void undoCodexBuild(storyId)} title="Take back everything this build made">
                Undo build
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
