// Under suggestion, in the Map room (the story map, phase 2, Adam 2026-10-24): who is under which hypnotic suggestion or
// command, as of a scene or the end of the story so far, read from the scenes by the memory. Each person's commands with
// what they make them do, wear and feel, their trigger, and their history through the story; Adam says a step the memory
// wasn't sure of is right or not, changes a command from a scene on, ends it or sets it off, and adds his own, each with
// Undo. Tracking is on per story; turning it on reads the scenes already written, with progress here.
import { useEffect, useMemo, useState } from 'react'
import type { CommandKind, CommandLasts, CommandStepView, CommandValues, CommandView, PersonUnder, TriggerBy, UnderSuggestion as Data } from '@shared/contracts/commands'
import type { Entry, ID } from '@shared/types'
import { Button, Checkbox, Field, Input, Segmented, Select, Switch, toast } from '@/components/ui'
import { Clock, Plus, Sparkles, Waves } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { LoadFailed, useLoaded } from '@/lib/useLoaded'
import { useOutline } from '@/features/binder/outlineStore'
import { useArrival } from '@/layout/desk/arrival'
import { defaultScene, KIND_OPTIONS, LASTS_OPTIONS, lastsWords, personSummary, piecesOf, sceneOptions, STATUS_WORDS, stepText, stepWords, type SceneOption } from './suggestionsLogic'

const fail = (e: unknown): void => void toast((e as Error).message, { tone: 'danger' })

/** Reloads whenever a story's commands change (a scene read, or a change made here). */
function useCommandsRev(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => onEvent('commands:changed', () => setRev((r) => r + 1)), [])
  return rev
}

export function UnderSuggestion({ storyId, sceneId }: { storyId: ID; sceneId?: ID | null }): React.JSX.Element {
  const arriving = useArrival('suggestions')
  const rev = useCommandsRev()
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const { outline } = useOutline()
  const scenes = useMemo(() => sceneOptions(outline), [outline])
  const asOf = sceneId ?? null
  const load = useLoaded(() => api.getUnderSuggestion(storyId, asOf), [storyId, asOf, rev, memoryRev, entriesRev])
  const people = useLoaded(() => api.listEntries('character'), [entriesRev])
  const data = load.value
  const [picked, setPicked] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const person = data?.people.find((p) => p.entryId === picked) ?? data?.people[0] ?? null
  const setAsOf = (id: ID | null): void => useApp.getState().navigate({ kind: 'suggestions', storyId, sceneId: id })

  const track = async (on: boolean): Promise<void> => {
    try {
      await api.setCommandTracking(storyId, on)
      load.retry()
      if (!on) toast('No longer tracking suggestions in this story. What was found stays.', { action: { label: 'Undo', run: () => void track(true) } })
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div data-arrive={arriving || undefined} role="region" aria-label="Under suggestion" className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-7 pb-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p className="max-w-[60ch] text-[13.5px] text-muted">Who is under which suggestion or command, read from the story so far. Every line comes from a scene, or from you.</p>
        <label className="flex items-center gap-2.5 text-[13.5px] font-medium">
          <Switch checked={!!data?.on} onChange={(v) => void track(v)} disabled={!data} aria-label="Track suggestions and commands in this story" />
          Track suggestions and commands in this story
        </label>
      </div>
      {load.failed ? <LoadFailed onRetry={load.retry} /> : null}
      {data && !data.on && !data.people.length ? (
        <TurnOn onTurnOn={() => void track(true)} />
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted">As of</span>
            <div className="w-[300px] max-w-full">
              <Select
                ariaLabel="As of which scene"
                value={asOf}
                allowNone
                noneLabel="The end of the story so far"
                onChange={(v) => setAsOf(v)}
                options={scenes.map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
            {data.reading ? <Reading done={data.reading.done} total={data.reading.total} /> : null}
          </div>
          <div className="grid grid-cols-[230px_minmax(0,1fr)] items-start gap-5">
            <div className="flex flex-col gap-4">
              <PeopleList people={data.people} picked={person?.entryId ?? null} onPick={(id) => { setPicked(id); setAdding(false) }} onAdd={() => setAdding(true)} />
              <Triggers data={data} onPick={setPicked} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {adding ? (
                <AddCommand
                  storyId={storyId}
                  scenes={scenes}
                  asOf={asOf}
                  characters={people.value ?? []}
                  subjectId={person?.entryId ?? null}
                  onDone={(subjectId) => {
                    setAdding(false)
                    if (subjectId) setPicked(subjectId)
                  }}
                />
              ) : person ? (
                <Person person={person} scenes={scenes} asOf={asOf} />
              ) : (
                <Nothing reading={!!data.reading} onAdd={() => setAdding(true)} />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function TurnOn({ onTurnOn }: { onTurnOn: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card bg-page p-6 shadow-e1">
      <Waves size={22} className="text-accent" />
      <h2 className="font-heading text-[19px] font-semibold">Keep track of suggestions and commands</h2>
      <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
        When a story has hypnosis in it, the memory can keep a record of every suggestion and command: who gave it, what it
        makes someone do, wear or feel, what sets it off, and how it changes as the story goes on. The AI is then told about
        them whenever it writes a scene with that person in it.
      </p>
      <p className="max-w-[62ch] text-[13px] text-faint">Turning it on reads the scenes you have written so far, one AI call each, in the background.</p>
      <Button variant="primary" onClick={onTurnOn}>
        Turn it on for this story
      </Button>
    </div>
  )
}

function Reading({ done, total }: { done: number; total: number }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 text-[13px] text-muted" role="status">
      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-(--dur-base) ease-glide" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
      </span>
      Reading the story for suggestions: scene {Math.min(done + 1, total)} of {total}
    </span>
  )
}

function PeopleList({ people, picked, onPick, onAdd }: { people: PersonUnder[]; picked: ID | null; onPick: (id: ID) => void; onAdd: () => void }): React.JSX.Element {
  const now = people.filter((p) => p.commands.some((c) => c.status !== 'ended'))
  const free = people.filter((p) => !p.commands.some((c) => c.status !== 'ended'))
  const row = (p: PersonUnder, sub: string): React.JSX.Element => (
    <button
      key={p.entryId}
      type="button"
      aria-current={p.entryId === picked ? 'true' : undefined}
      onClick={() => onPick(p.entryId)}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-[10px] px-3 py-2 text-left transition-[background-color,box-shadow] duration-(--dur-quick) ease-glide',
        p.entryId === picked ? 'bg-page shadow-e1' : 'hover:bg-surface-2'
      )}
    >
      <span className="text-[13.5px] font-semibold">{p.name}</span>
      <span className="text-[12px] text-faint">{sub}</span>
    </button>
  )
  return (
    <nav aria-label="People under suggestion" className="flex flex-col gap-1 rounded-card bg-surface p-2 shadow-e1">
      <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Under something now</h3>
      {now.length ? now.map((p) => row(p, personSummary(p.commands))) : <p className="px-3 pb-2 text-[12.5px] text-faint">No one, as of here.</p>}
      {free.length ? (
        <>
          <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Free of it now</h3>
          {free.map((p) => row(p, `${p.commands.length === 1 ? 'One' : p.commands.length} over`))}
        </>
      ) : null}
      <button type="button" onClick={onAdd} className="mt-2 flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-accent hover:bg-surface-2">
        <Plus size={14} /> Add one yourself
      </button>
    </nav>
  )
}

function Nothing({ reading, onAdd }: { reading: boolean; onAdd: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card bg-page p-5 shadow-e1">
      <p className="text-[14px] font-semibold">{reading ? 'Nothing found yet.' : 'No suggestions or commands as of here.'}</p>
      <p className="text-[13px] text-muted">
        {reading ? 'The story is being read; they appear here as they are found.' : 'They are picked up as you write. You can also add one yourself.'}
      </p>
      <Button size="sm" icon={<Plus size={14} />} onClick={onAdd}>
        Add one yourself
      </Button>
    </div>
  )
}

function Person({ person, scenes, asOf }: { person: PersonUnder; scenes: SceneOption[]; asOf: ID | null }): React.JSX.Element {
  const cover = person.commands.find((c) => person.commands.some((o) => o.coveredBy === c.id))
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 className="font-heading text-[21px] font-semibold">{person.name}</h2>
        {person.wearing ? (
          <span className="text-[13px] text-muted">
            Wears, by command: <b className="font-semibold text-fg">{person.wearing}</b>
            {cover ? ` (“${cover.values.words || cover.values.does}” covers the rest while it holds)` : ''}
          </span>
        ) : null}
      </div>
      {person.commands.map((c) => (
        <Command key={c.id} c={c} name={person.name.split(/\s+/)[0]} scenes={scenes} asOf={asOf} covered={person.commands.find((o) => o.id === c.coveredBy) ?? null} />
      ))}
    </>
  )
}

function StatusPill({ c }: { c: CommandView }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold',
        c.status === 'in-effect' && 'bg-accent-soft text-accent',
        c.status === 'waiting' && 'bg-surface-2 text-fg',
        c.status === 'ended' && 'bg-surface-2 text-faint'
      )}
    >
      {c.status === 'waiting' ? <Clock size={12} /> : null}
      {STATUS_WORDS[c.status]}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line pt-2 text-[13.5px] leading-snug">
      <span className="text-[12px] font-semibold text-faint">{label}</span>
      <span>{children}</span>
    </div>
  )
}

type Acting = null | 'change' | 'end' | 'fire'

function Command({ c, name, scenes, asOf, covered }: { c: CommandView; name: string; scenes: SceneOption[]; asOf: ID | null; covered: CommandView | null }): React.JSX.Element {
  const [acting, setActing] = useState<Acting>(null)
  const v = c.values
  const ended = c.status === 'ended'
  return (
    <article aria-label={v.words || v.does} className={cn('flex flex-col gap-2.5 rounded-card bg-page p-4 shadow-e1', ended && 'opacity-75')}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-serif text-[16px] leading-snug">“{v.words || v.does}”</p>
        <StatusPill c={c} />
      </div>
      {covered ? <p className="text-[12.5px] text-muted">Covered by “{covered.values.words || covered.values.does}” while that holds; it still holds underneath.</p> : null}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-[900px]:grid-cols-1">
        {c.giverName ? <Row label="Given by">{c.giverName}</Row> : null}
        <Row label="Trigger">{v.trigger ? `When ${v.trigger}${v.triggerBy === 'giver' && c.giverName ? ` (only ${c.giverName})` : ''}` : 'None: it holds at once'}</Row>
        {v.does ? <Row label={`Makes ${name}`}>{v.does}</Row> : null}
        {v.kind === 'clothing' && (v.all || v.off.length) ? <Row label="Clothing">{v.all ? 'Keeps every piece off' : v.off.map((p) => `no ${p}`).join(', ')}</Row> : null}
        <Row label="Lasts">{lastsWords(v)}{c.fired ? ` · set off ${c.fired === 1 ? 'once' : `${c.fired} times`} so far` : ''}</Row>
        {v.feels ? <Row label="How it feels">{v.feels}</Row> : null}
      </div>
      <History steps={c.steps} />
      {acting ? (
        <Act c={c} acting={acting} scenes={scenes} asOf={asOf} onDone={() => setActing(null)} />
      ) : !ended ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setActing('change')}>
            Change it from a scene…
          </Button>
          {c.waiting ? (
            <Button size="sm" variant="ghost" onClick={() => setActing('fire')}>
              Set it off in a scene…
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setActing('end')}>
            End it…
          </Button>
        </div>
      ) : null}
    </article>
  )
}

function History({ steps }: { steps: CommandStepView[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Through the story</h4>
      <ol className="flex flex-col">
        {steps.map((s) => (
          <li key={s.id} className={cn('grid grid-cols-[96px_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-line py-1.5 text-[13px]', s.later && 'opacity-50')}>
            <span className="text-[12px] font-semibold text-faint tabular-nums">{s.where}</span>
            <span className="min-w-0">
              <b className={cn('mr-1.5 font-semibold', s.unsure && !s.answer && 'text-ai')}>{stepWords(s)}</b>
              <span className="text-muted">{stepText(s)}</span>
              {s.unsure && s.answer === '' ? <span className="ml-1.5 text-[12px] text-ai">The AI isn’t sure. Is this right?</span> : null}
            </span>
            <StepActions s={s} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function StepActions({ s }: { s: CommandStepView }): React.JSX.Element | null {
  const answer = async (a: 'yes' | 'no'): Promise<void> => {
    try {
      await api.answerCommandStep(s.id, a)
      if (a === 'no') toast('Left out. It won’t come back when the scene is read again.', { action: { label: 'Undo', run: () => void api.clearCommandAnswer(s.id).catch(fail) } })
    } catch (e) {
      fail(e)
    }
  }
  if (s.origin === 'adam') {
    return (
      <button type="button" className="text-[12px] font-semibold text-accent hover:underline" onClick={() => void api.undoCommandStep(s.id).catch(fail)}>
        Undo
      </button>
    )
  }
  if (s.unsure && s.answer === '') {
    return (
      <span className="flex gap-2">
        <button type="button" className="text-[12px] font-semibold text-accent hover:underline" onClick={() => void answer('yes')}>
          Yes
        </button>
        <button type="button" className="text-[12px] font-semibold text-muted hover:text-fg hover:underline" onClick={() => void answer('no')}>
          No
        </button>
      </span>
    )
  }
  return (
    <button type="button" className="text-[12px] text-faint hover:text-fg hover:underline" title="This isn’t what the scene says" onClick={() => void answer('no')}>
      Not right
    </button>
  )
}

/** Changing, ending or setting off a command from a scene on. */
function Act({ c, acting, scenes, asOf, onDone }: { c: CommandView; acting: Exclude<Acting, null>; scenes: SceneOption[]; asOf: ID | null; onDone: () => void }): React.JSX.Element {
  const [sceneId, setScene] = useState<ID | null>(defaultScene(scenes, asOf))
  const [does, setDoes] = useState(c.values.does)
  const [trigger, setTrigger] = useState(c.values.trigger)
  const [feels, setFeels] = useState(c.values.feels)
  const [lasts, setLasts] = useState<CommandLasts>(c.values.lasts)
  const [stronger, setStronger] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const where = scenes.find((s) => s.value === sceneId)?.label.split(' · ')[0] ?? 'that scene'
  const save = async (): Promise<void> => {
    if (!sceneId) return
    const values: Partial<CommandValues> = {}
    if (acting === 'change') {
      if (does.trim() !== c.values.does) values.does = does.trim()
      if (trigger.trim() !== c.values.trigger) values.trigger = trigger.trim()
      if (feels.trim() !== c.values.feels) values.feels = feels.trim()
      if (lasts !== c.values.lasts) values.lasts = lasts
    }
    setBusy(true)
    try {
      const kind = acting === 'end' ? 'ended' : acting === 'fire' ? 'fired' : stronger ? 'stronger' : 'changed'
      const id = await api.changeCommand({ commandId: c.id, sceneId, kind, values, note })
      const said = acting === 'end' ? `Ended from ${where}.` : acting === 'fire' ? `Set off in ${where}.` : `Changed from ${where} on.`
      toast(said, { action: { label: 'Undo', run: () => void api.undoCommandStep(id).catch(fail) } })
      onDone()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-surface p-3">
      <Field label={acting === 'change' ? 'From which scene on' : acting === 'end' ? 'It ends in' : 'It goes off in'}>
        {(id) => <Select id={id} value={sceneId} onChange={setScene} options={scenes.map((s) => ({ value: s.value, label: s.label }))} />}
      </Field>
      {acting === 'change' ? (
        <>
          <Field label="What it makes them do">{(id) => <Input id={id} value={does} onChange={(e) => setDoes(e.target.value)} />}</Field>
          <Field label="What sets it off" hint="Leave empty if it holds at once.">
            {(id) => <Input id={id} value={trigger} onChange={(e) => setTrigger(e.target.value)} />}
          </Field>
          <Field label="How it feels to them">{(id) => <Input id={id} value={feels} onChange={(e) => setFeels(e.target.value)} />}</Field>
          <Segmented label="How long it lasts" value={lasts} onChange={setLasts} options={LASTS_OPTIONS} />
          <Checkbox size="sm" checked={stronger} onChange={setStronger} label="It’s made stronger here" />
        </>
      ) : null}
      <Field label="A note for yourself (optional)">{(id) => <Input id={id} value={note} placeholder={acting === 'end' ? 'She woke up from it' : ''} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!sceneId} onClick={() => void save()}>
          {acting === 'change' ? 'Save the change' : acting === 'end' ? 'End it there' : 'Set it off there'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function AddCommand({
  storyId,
  scenes,
  asOf,
  characters,
  subjectId,
  onDone
}: {
  storyId: ID
  scenes: SceneOption[]
  asOf: ID | null
  characters: Entry[]
  subjectId: ID | null
  onDone: (subjectId: ID | null) => void
}): React.JSX.Element {
  const [who, setWho] = useState<ID | null>(subjectId)
  const [by, setBy] = useState<ID | null>(null)
  const [sceneId, setScene] = useState<ID | null>(defaultScene(scenes, asOf))
  const [words, setWords] = useState('')
  const [does, setDoes] = useState('')
  const [kind, setKind] = useState<CommandKind>('clothing')
  const [off, setOff] = useState('')
  const [all, setAll] = useState(false)
  const [trigger, setTrigger] = useState('')
  const [triggerBy, setTriggerBy] = useState<TriggerBy>('anyone')
  const [every, setEvery] = useState(false)
  const [lasts, setLasts] = useState<CommandLasts>('story')
  const [feels, setFeels] = useState('')
  const [busy, setBusy] = useState(false)
  const people = characters.map((e) => ({ value: e.id, label: e.name }))
  const add = async (): Promise<void> => {
    if (!who || !sceneId) return
    setBusy(true)
    try {
      const values: Partial<CommandValues> = { words, does, kind, off: kind === 'clothing' ? piecesOf(off) : [], all: kind === 'clothing' && all, trigger, triggerBy, every, lasts, feels }
      const id = await api.addCommand({ storyId, sceneId, subjectId: who, giverId: by, values })
      const first = (await api.getUnderSuggestion(storyId, null)).people.flatMap((p) => p.commands).find((c) => c.id === id)?.steps[0]?.id
      toast('Added.', first ? { action: { label: 'Undo', run: () => void api.undoCommandStep(first).catch(fail) } } : {})
      onDone(who)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Add a suggestion or command" className="flex flex-col gap-3 rounded-card bg-page p-4 shadow-e1">
      <h2 className="font-heading text-[18px] font-semibold">Add a suggestion or command</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Who is under it">{(id) => <Select id={id} value={who} onChange={setWho} options={people} placeholder="Choose someone…" />}</Field>
        <Field label="Who gave it">{(id) => <Select id={id} value={by} onChange={setBy} options={people} allowNone noneLabel="Not known" />}</Field>
      </div>
      <Field label="What was said">{(id) => <Input id={id} value={words} placeholder="You won’t wear socks any more" onChange={(e) => setWords(e.target.value)} />}</Field>
      <Field label="What it makes them do">{(id) => <Input id={id} value={does} placeholder="Wears no socks" onChange={(e) => setDoes(e.target.value)} />}</Field>
      <Segmented label="What it changes" value={kind} onChange={setKind} options={KIND_OPTIONS} />
      {kind === 'clothing' ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <Field label="What it keeps off" hint="Pieces of clothing, with commas between.">
            {(id) => <Input id={id} value={off} disabled={all} placeholder="socks, bra" onChange={(e) => setOff(e.target.value)} />}
          </Field>
          <Checkbox size="sm" className="pb-6" checked={all} onChange={setAll} label="Every piece" />
        </div>
      ) : null}
      <Field label="What sets it off" hint="Leave empty if it holds as soon as it’s given.">
        {(id) => <Input id={id} value={trigger} placeholder="She hears the word ‘banana’" onChange={(e) => setTrigger(e.target.value)} />}
      </Field>
      {trigger.trim() ? (
        <div className="flex flex-wrap items-center gap-4">
          <Segmented
            label="Who can set it off"
            value={triggerBy}
            onChange={setTriggerBy}
            options={[
              { value: 'anyone', label: 'Anyone' },
              { value: 'giver', label: 'Only who gave it' }
            ]}
          />
          <Checkbox size="sm" checked={every} onChange={setEvery} label="Works every time" />
        </div>
      ) : null}
      <Segmented label="How long it lasts" value={lasts} onChange={setLasts} options={LASTS_OPTIONS} />
      <Field label="How it feels to them (optional)">{(id) => <Input id={id} value={feels} placeholder="Like her own idea" onChange={(e) => setFeels(e.target.value)} />}</Field>
      <Field label="Given in">{(id) => <Select id={id} value={sceneId} onChange={setScene} options={scenes.map((s) => ({ value: s.value, label: s.label }))} />}</Field>
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} disabled={!who || !sceneId || (!words.trim() && !does.trim())} onClick={() => void add()}>
          Add it
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

function Triggers({ data, onPick }: { data: Data; onPick: (id: ID) => void }): React.JSX.Element {
  const idOf = (commandId: ID): ID | null => data.people.find((p) => p.commands.some((c) => c.id === commandId))?.entryId ?? null
  return (
    <aside aria-label="Triggers waiting" className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-e1">
      <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Triggers waiting</h3>
      {data.triggers.length ? (
        data.triggers.map((t) => (
          <button
            key={t.commandId}
            type="button"
            onClick={() => {
              const id = idOf(t.commandId)
              if (id) onPick(id)
            }}
            className="flex flex-col items-start gap-0.5 rounded-[10px] bg-page px-3 py-2 text-left shadow-e1 hover:shadow-e2"
          >
            <span className="text-[13px] font-semibold">{t.subjectName}</span>
            <span className="text-[12.5px] text-muted">
              When {t.trigger}: {t.does}
            </span>
            <span className="text-[11.5px] text-faint">{t.triggerBy === 'giver' && t.giverName ? `Only ${t.giverName} can set it off` : 'Anyone can set it off'}</span>
          </button>
        ))
      ) : (
        <p className="px-1 pb-1 text-[12.5px] text-faint">None waiting as of here.</p>
      )}
      <p className="flex gap-1.5 px-1 pt-2 text-[12px] leading-snug text-faint">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-ai" />
        The AI is told about these whenever it writes a scene with them in it, so it sets one off only when you mean it to.
      </p>
    </aside>
  )
}
