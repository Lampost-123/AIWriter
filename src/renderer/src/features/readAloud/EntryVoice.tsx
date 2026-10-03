// Adapted from mcreader-v2, src/components/speech/CastCard.tsx (its character row: How they sound, Suggest with
// "Use this", Hear, the voice from the list and "Say it as" with Listen; reading aloud's own text-to-speech code;
// Adam's rule, 2 October 2026). MCreader kept a cast per story; AI Write keeps these per entry in the world.
//
// On an entry's page: a character's "Read-aloud voice" (Suggest, Hear) and, for any entry, "Say it as"
// with Listen. Kept in the world's meta key read_aloud. Shown in features/world/EntryForm.tsx only once
// read aloud is turned on. Owned by the Read aloud part. Changes save as Adam types.
import { AudioLines, Check, Play, Sparkles, Square, Volume2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { EntryReadAloud } from '@shared/contracts/readAloud'
import type { Entry } from '@shared/types'
import { Button, Field, Input, Notice, Select, Spinner } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { openSpeechSettings } from './control'
import { clearSampleError, playSample, useSample } from './useSample'
import { useVoices } from './useVoices'

export function EntryVoice({ entry }: { entry: Entry }): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech.readAloud)
  if (!on) return null
  return <VoiceBox key={entry.id} entry={entry} />
}

const EMPTY: EntryReadAloud = { voice: { design: '', voice: '' }, say: '' }

/** A suggestion streaming in, or waiting for "Use this". */
type Proposal = { text: string; writing: boolean }

/** A description as the AI writes it, without the quote marks it may wrap it in. */
const tidy = (text: string): string => text.trim().replace(/^["“]/, '').replace(/["”]$/, '').trim()

function VoiceBox({ entry }: { entry: Entry }): React.JSX.Element {
  const character = entry.kind === 'character'
  const castVoices = useApp((s) => s.settings?.speech.castVoices ?? true)
  const [value, setValue] = useState<EntryReadAloud | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const current = useRef<EntryReadAloud>(EMPTY)
  // As last read or saved: what the box and the world agree on, so a change from elsewhere can be told from Adam's.
  const synced = useRef<EntryReadAloud>(EMPTY)
  const { voices } = useVoices(character)
  const ids = { design: useId(), say: useId(), title: useId() }
  const owns = useCallback((label: string) => label.endsWith(`:${entry.id}`) && label.startsWith('entry:'), [entry.id])
  const sample = useSample(owns)

  useEffect(() => {
    let live = true
    api
      .getEntryReadAloud(entry.id)
      .then((v) => {
        if (!live) return
        current.current = v
        synced.current = v
        setValue(v)
      })
      .catch((e: Error) => live && setLoadError(e.message))
    return () => {
      live = false
    }
  }, [entry.id])

  // The AI gave them a voice in the background (it made or filled in this character): it shows here, in any box
  // Adam hasn't changed since it was last saved.
  useEffect(
    () =>
      onEvent('memory:changed', (change) => {
        if (!change.entryIds.includes(entry.id)) return
        void api
          .getEntryReadAloud(entry.id)
          .then((now) => {
            const was = synced.current
            const mine = current.current
            const pick = (here: string, before: string, there: string): string => (here === before ? there : here)
            const next: EntryReadAloud = {
              voice: {
                design: pick(mine.voice.design, was.voice.design, now.voice.design),
                voice: pick(mine.voice.voice, was.voice.voice, now.voice.voice)
              },
              say: pick(mine.say, was.say, now.say)
            }
            synced.current = now
            if (next.voice.design === mine.voice.design && next.voice.voice === mine.voice.voice && next.say === mine.say) return
            current.current = next
            setValue(next)
          })
          .catch(() => undefined)
      }),
    [entry.id]
  )

  const name = entry.name.trim() || 'this entry'
  const autosave = useAutosave<EntryReadAloud>(
    (v) =>
      api.setEntryReadAloud(entry.id, v).then((saved) => {
        synced.current = saved
        return saved
      }),
    { what: character ? `${name}'s read-aloud voice` : `how ${name} is said` }
  )
  const update = (patch: { design?: string; voice?: string; say?: string }): void => {
    const was = current.current
    const next: EntryReadAloud = {
      voice: { design: patch.design ?? was.voice.design, voice: patch.voice ?? was.voice.voice },
      say: patch.say ?? was.say
    }
    current.current = next
    setValue(next)
    autosave.schedule(next)
    clearSampleError(owns)
  }

  // ----- Suggest -----
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const task = useRef<string | null>(null)
  useEffect(
    () => () => {
      // Leaving the page stops a suggestion still being written.
      if (task.current) void api.stopTask(task.current).catch(() => undefined)
    },
    []
  )
  const suggest = async (): Promise<void> => {
    await autosave.flush()
    const taskId = crypto.randomUUID()
    task.current = taskId
    setSuggestError(null)
    setProposal({ text: '', writing: true })
    const off = onEvent('task:progress', (p) => {
      if (p.taskId === taskId) setProposal((was) => (was?.writing ? { text: tidy(p.text), writing: true } : was))
    })
    try {
      const res = await api.suggestCharacterVoice(entry.id, taskId)
      if (task.current !== taskId) return
      const text = tidy(res.design)
      if (res.status === 'error' || !text) {
        setProposal(null)
        if (res.status !== 'stopped') setSuggestError(res.error ?? "The AI didn't suggest anything. Try again.")
        return
      }
      setProposal({ text, writing: false })
    } catch (e) {
      if (task.current !== taskId) return
      setProposal(null)
      setSuggestError((e as Error).message)
    } finally {
      off()
      if (task.current === taskId) task.current = null
    }
  }
  const stopSuggest = (): void => {
    if (task.current) void api.stopTask(task.current).catch(() => undefined)
  }

  // ----- Hear and Listen -----
  const hearLabel = `entry:hear:${entry.id}`
  const sayLabel = `entry:say:${entry.id}`
  const hear = async (): Promise<void> => {
    await autosave.flush()
    void playSample(hearLabel, { kind: 'character', entryId: entry.id })
  }
  const listen = async (): Promise<void> => {
    await autosave.flush()
    void playSample(sayLabel, { kind: 'say', entryId: entry.id })
  }
  const busy = (label: string): boolean => sample.playing === label || sample.loading === label

  const v = value ?? EMPTY
  const own = !!(v.voice.design.trim() || v.voice.voice)
  const listed = voices ?? []
  const voiceOptions = [
    ...listed.map((x) => ({ value: x.id, label: x.name, hint: x.clip ? 'your clip' : undefined })),
    ...(v.voice.voice && !listed.some((x) => x.id === v.voice.voice) ? [{ value: v.voice.voice, label: v.voice.voice }] : [])
  ]

  return (
    <section aria-labelledby={ids.title} className="mt-6 rounded-lg border border-line bg-surface px-3 pb-3 pt-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <AudioLines size={13} className="text-muted" aria-hidden />
        <h3 id={ids.title} className="flex-1 text-[12px] font-medium text-muted">
          {character ? 'Read-aloud voice' : 'Read aloud'}
        </h3>
        <SaveNote status={autosave.status} error={autosave.error} />
      </div>

      {loadError ? (
        <p className="text-[12.5px] text-muted">{loadError}</p>
      ) : !value ? (
        // Its height is kept while it loads, so the page below doesn't move.
        <div className={character ? 'min-h-[236px]' : 'min-h-[86px]'} aria-busy />
      ) : (
        <div className="flex flex-col gap-4 animate-fade-in">
          {character ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={ids.design} className="text-[12px] font-medium text-muted">
                  How they sound
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles size={13} />}
                    disabled={!!proposal?.writing}
                    title="The AI describes their voice from their age, looks, background and lines. Nothing is kept until you pick Use this."
                    onClick={() => void suggest()}
                  >
                    Suggest
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!own && !busy(hearLabel)}
                    title={own ? `Hear ${name} say one of their lines` : 'Describe how they sound, or pick a voice, first'}
                    icon={
                      sample.loading === hearLabel ? (
                        <Spinner size={12} />
                      ) : sample.playing === hearLabel ? (
                        <Square size={10} />
                      ) : (
                        <Play size={12} />
                      )
                    }
                    onClick={() => (busy(hearLabel) ? playSample(hearLabel, { kind: 'character', entryId: entry.id }) : void hear())}
                    className="w-[72px]"
                  >
                    {busy(hearLabel) ? 'Stop' : 'Hear'}
                  </Button>
                </div>
              </div>
              <AutoTextarea
                id={ids.design}
                value={v.voice.design}
                minRows={2}
                maxRows={8}
                maxLength={600}
                placeholder="A man in his sixties, deep and gravelly, with a slow Glaswegian accent and dry humour."
                onChange={(e) => update({ design: e.target.value })}
              />
              {proposal ? (
                <div className="rounded-lg border border-ai/30 bg-ai-soft px-3 py-2.5 animate-fade-in" aria-live="polite">
                  <p className="text-[12px] text-muted">
                    {proposal.writing ? 'Writing a description…' : 'Suggested from what the world knows about them:'}
                  </p>
                  <p className="mt-1 min-h-[1.5em] text-[13.5px] leading-relaxed text-fg">{proposal.text}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {proposal.writing ? (
                      <Button size="sm" variant="ghost" icon={<Square size={10} />} onClick={stopSuggest}>
                        Stop
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ai"
                          icon={<Check size={13} />}
                          onClick={() => {
                            // The description is the voice now, rather than one picked from the list.
                            update({ design: proposal.text, voice: '' })
                            setProposal(null)
                          }}
                        >
                          Use this
                        </Button>
                        <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setProposal(null)}>
                          Discard
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
              {suggestError ? <p className="text-[12.5px] text-muted">{suggestError}</p> : null}
              <Field label="Or a voice from the list">
                {(id) => (
                  <Select
                    id={id}
                    value={v.voice.voice || null}
                    onChange={(voice) => update({ voice: voice ?? '' })}
                    options={voiceOptions}
                    allowNone
                    noneLabel="Made from the description"
                  />
                )}
              </Field>
              <p className="text-[12px] text-faint">
                {v.voice.voice
                  ? 'This voice reads their lines; the description is kept in case you go back to it.'
                  : v.voice.design.trim()
                    ? 'The voice is made from the description once and kept, so it never drifts. Changing the words makes a new voice.'
                    : 'With neither, their lines are read in the dialogue voice.'}
              </p>
              {!castVoices ? (
                <Notice
                  action={
                    <Button size="sm" variant="ghost" onClick={openSpeechSettings}>
                      Settings
                    </Button>
                  }
                >
                  Characters’ own voices are turned off, so everyone’s lines are read in the dialogue voice.
                </Notice>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={ids.say} className="text-[12px] font-medium text-muted">
                Say it as
              </label>
              <Button
                size="sm"
                variant="ghost"
                icon={
                  sample.loading === sayLabel ? (
                    <Spinner size={12} />
                  ) : sample.playing === sayLabel ? (
                    <Square size={10} />
                  ) : (
                    <Volume2 size={13} />
                  )
                }
                title={`Hear how the voice says ${name}`}
                onClick={() => (busy(sayLabel) ? playSample(sayLabel, { kind: 'say', entryId: entry.id }) : void listen())}
                className="w-[78px]"
              >
                {busy(sayLabel) ? 'Stop' : 'Listen'}
              </Button>
            </div>
            <Input
              id={ids.say}
              value={v.say}
              maxLength={200}
              placeholder={`Only if a narrator could misread it: “shiv-AWN”, or “Siobhan = shiv-AWN; Nguyen = win”`}
              onChange={(e) => update({ say: e.target.value })}
            />
            <p className="text-[12px] text-faint">Only the voice hears this; the page keeps the name as written.</p>
          </div>

          {sample.error ? (
            <Notice
              action={
                sample.error.engine ? (
                  <Button size="sm" onClick={openSpeechSettings}>
                    Open speech settings
                  </Button>
                ) : undefined
              }
            >
              {sample.error.message}
            </Notice>
          ) : null}
        </div>
      )}
    </section>
  )
}
