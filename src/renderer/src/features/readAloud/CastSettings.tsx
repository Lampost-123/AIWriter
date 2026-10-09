// Adapted from mcreader-v2, src/components/speech/CastCard.tsx (its cast of characters, each with their voice, Hear
// and a voice to pick; reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader kept a cast per
// story; AI Write keeps each character's voice on their page in the world (EntryVoice.tsx), and this lists them all.
//
// Settings › Read aloud and dictation › Cast, with read aloud on and a world open: every character with their portrait,
// the voice their lines are read in now (castText.ts), Hear, a voice from the list (saved at once, as on their page)
// and Open page (their page at its Read-aloud voice box). "Give everyone without a voice a voice" gives each character
// with none a studio voice that fits them, as reading does when they first speak, and says who got which, with Undo.
// Owned by the Read aloud part.
import { ArrowUpRight, Play, Square, Users, Undo2 } from '@/components/ui/icons'
import { useCallback, useEffect, useId, useState } from 'react'
import type { CastEntry, EntryReadAloud, ReadAloudVoice } from '@shared/contracts/readAloud'
import type { ID } from '@shared/types'
import { Button, Notice, Select, SettingsSection, Spinner, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { Portrait } from '@/features/views/Portrait'
import { useSpeechStatus } from '@/features/speech/useSpeechStatus'
import { castVoiceText, givenText, voiceless } from './castText'
import { clearSampleError, playSample, useSample } from './useSample'
import { useVoices } from './useVoices'
import { CAST_SECTION, openEntryVoice } from './voiceReveal'

/** The Hear buttons on this list, for the sample player. */
const OURS = (label: string): boolean => label.startsWith('cast:')

/** What Give everyone a voice did, until it is undone or the list changes by hand. */
interface Given {
  text: string
  before: Record<ID, EntryReadAloud>
}

export function CastSettings(): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech.readAloud)
  const worldId = useApp((s) => s.world?.id ?? null)
  if (!on || !worldId) return null
  return <Cast key={worldId} />
}

function Cast(): React.JSX.Element {
  const castVoices = useApp((s) => s.settings?.speech.castVoices ?? true)
  const entriesRev = useApp((s) => s.entriesRev)
  const { voices } = useVoices(true)
  const studio = !!useSpeechStatus()?.installed.studio
  const sample = useSample(OURS)
  const [rows, setRows] = useState<CastEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [giving, setGiving] = useState(false)
  const [given, setGiven] = useState<Given | null>(null)

  const load = useCallback(async (): Promise<CastEntry[] | null> => {
    try {
      const list = await api.readAloudCast()
      setRows(list)
      setError(null)
      return list
    } catch (e) {
      setError((e as Error).message || 'The cast couldn’t be listed.')
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, entriesRev])
  // A voice given in the background (as someone first speaks, or the AI describing a new character) shows here too.
  useEffect(() => onEvent('memory:changed', (c) => void (c.entryIds.length ? load() : undefined)), [load])

  const pick = async (row: CastEntry, voice: string): Promise<void> => {
    const next: EntryReadAloud = { ...row.value, voice: { design: row.value.voice.design, voice } }
    setRows((list) => list?.map((r) => (r.id === row.id ? { ...r, value: next, auto: false } : r)) ?? list)
    setGiven(null)
    clearSampleError(OURS)
    try {
      await api.setEntryReadAloud(row.id, next)
    } catch (e) {
      toast(`${row.name}’s voice couldn’t be saved. ${(e as Error).message}`, { tone: 'danger' })
    }
    void load()
  }

  const giveEveryone = async (): Promise<void> => {
    setGiving(true)
    try {
      const res = await api.castVoicelessCharacters()
      const list = (await load()) ?? []
      if (!res.given.length) {
        setGiven(null)
        toast('No studio voice was free to give. Pick their voices from the list instead.')
      } else setGiven({ text: givenText(res.given, list, voices), before: res.before })
    } catch (e) {
      toast((e as Error).message || 'The voices couldn’t be given.', { tone: 'danger' })
    } finally {
      setGiving(false)
    }
  }

  const undo = async (): Promise<void> => {
    if (!given) return
    try {
      await api.restoreStudioVoices(given.before)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
    setGiven(null)
    void load()
  }

  const without = rows?.filter(voiceless) ?? []
  const giveHint = !studio
    ? 'Needs the studio voices: download them under Speech engine, above.'
    : !without.length
      ? 'Everyone here has a voice of their own.'
      : `${without.length === 1 ? 'One character has' : `${without.length} characters have`} no voice yet: each gets a studio voice that fits them, as when they first speak.`

  return (
    <div id={CAST_SECTION} className="scroll-mt-6">
      <SettingsSection
        title="Cast"
        description="Every character in this world and the voice their lines are read in. Pick one here, or open their page to describe how they sound."
      >
        <div className="flex max-w-2xl flex-col gap-3">
          {!castVoices ? (
            <Notice>
              Characters’ own voices are turned off (More › Dialogue and characters), so everyone is read in the dialogue voice.
            </Notice>
          ) : null}
          {error ? (
            <p className="text-[12.5px] text-muted">{error}</p>
          ) : !rows ? (
            <p className="flex h-10 items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={13} className="text-faint" /> Finding the characters…
            </p>
          ) : !rows.length ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-muted">
              No characters in this world yet. Each one you add shows here with their voice.
            </p>
          ) : (
            <ul aria-label="Cast" className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
              {rows.map((row) => (
                <CastRow
                  key={row.id}
                  row={row}
                  voices={voices}
                  playing={sample.playing === `cast:${row.id}`}
                  loading={sample.loading === `cast:${row.id}`}
                  onPick={(voice) => void pick(row, voice)}
                />
              ))}
            </ul>
          )}

          {sample.error ? (
            <Notice
              action={
                <Button size="sm" variant="ghost" onClick={() => clearSampleError(OURS)}>
                  Dismiss
                </Button>
              }
            >
              {sample.error.message}
            </Notice>
          ) : null}

          {rows?.length ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                size="sm"
                icon={<Users size={14} />}
                loading={giving}
                disabled={!studio || !without.length}
                onClick={() => void giveEveryone()}
              >
                Give everyone without a voice a voice
              </Button>
              <span className="min-w-[200px] flex-1 text-[12.5px] leading-relaxed text-muted">{giveHint}</span>
            </div>
          ) : null}
          {given ? (
            <div role="status">
              <Notice
                tone="success"
                action={
                  <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => void undo()}>
                    Undo
                  </Button>
                }
              >
                <span className="font-medium">Given voices: </span>
                {given.text}
              </Notice>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  )
}

/** One character: portrait, name and their voice now; Hear, a voice from the list, and Open page. */
function CastRow({
  row,
  voices,
  playing,
  loading,
  onPick
}: {
  row: CastEntry
  voices: ReadAloudVoice[] | null
  playing: boolean
  loading: boolean
  onPick: (voice: string) => void
}): React.JSX.Element {
  const selectId = useId()
  const v = row.value.voice
  const own = !!(v.voice || v.design.trim())
  const listed = voices ?? []
  const options = [
    ...listed.map((x) => ({ value: x.id, label: x.name, hint: x.clip ? 'your clip' : x.studio ? 'studio' : undefined })),
    ...(v.voice && !listed.some((x) => x.id === v.voice) ? [{ value: v.voice, label: row.studioName ?? v.voice }] : [])
  ]
  const label = `cast:${row.id}`
  return (
    <li data-cast={row.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
      <Portrait entry={{ name: row.name, kind: 'character', image: row.image }} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-fg">{row.name}</p>
        <p className="truncate text-[12px] text-muted" data-cast-voice>
          {castVoiceText(row, voices)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={playing ? `Stop ${row.name}` : `Hear ${row.name}`}
          title={own ? `Hear ${row.name} say one of their lines` : `Hear ${row.name} in the dialogue voice`}
          onClick={() => void playSample(label, { kind: 'character', entryId: row.id })}
          className={
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
            (playing ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-page text-muted hover:text-fg')
          }
        >
          {loading ? <Spinner size={12} /> : playing ? <Square size={10} /> : <Play size={12} />}
        </button>
        <label htmlFor={selectId} className="sr-only">
          {`${row.name}’s voice`}
        </label>
        <Select
          id={selectId}
          value={v.voice || null}
          onChange={(voice) => onPick(voice ?? '')}
          options={options}
          allowNone
          noneLabel={v.design.trim() ? 'Made from their description' : 'Dialogue voice'}
          className="w-[220px]"
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowUpRight size={14} />}
          title={`Open ${row.name}’s page at their voice`}
          onClick={() => openEntryVoice(row.id)}
        >
          Open page
        </Button>
      </div>
    </li>
  )
}
