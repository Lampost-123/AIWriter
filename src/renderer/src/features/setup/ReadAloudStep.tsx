// The first run's read-aloud step: read aloud needs a one-time download, offered here with Download now or Later.
// It is Settings › Read aloud and dictation's own download (the voices, then the studio voices), with its own
// progress cards, so it carries on in the background once the setup moves on. A computer whose graphics card can't
// run the voices is told so plainly instead; one that has them already is told it is ready.

import { AudioLines, Users } from '@/components/ui/icons'
import { useState } from 'react'
import { Card, Notice, toast } from '@/components/ui'
import { download, DownloadFor, KINDS } from '@/features/speech/SpeechEngineSettings'
import { useSpeechStatus } from '@/features/speech/useSpeechStatus'
import { CARD_GB, VOICES_NEEDS } from '@/features/speech/voiceNeeds'
import { readAloudOffer } from './setupLogic'
import { goBack, goNext, StepFrame } from './StepFrame'

/** Where read aloud is kept, for "Later" and the computer that can't run it. */
const IN_SETTINGS = 'Settings › Read aloud and dictation'

export function ReadAloudStep(): React.JSX.Element {
  const status = useSpeechStatus()
  const [starting, setStarting] = useState(false)
  const offer = status ? readAloudOffer(status) : null
  const offering = !offer || offer.kind === 'offer'

  const start = async (): Promise<void> => {
    setStarting(true)
    // The studio voices download the voices first when they aren't here yet.
    await download('studio')
    setStarting(false)
  }

  const later = (): void => {
    toast(`Read aloud is in ${IN_SETTINGS} whenever you want it.`)
    goNext('voices')
  }

  return (
    <StepFrame
      title="Hear your stories read aloud"
      intro="AI Write can read your scenes to you, with a voice for the narrator and each character. It runs on this computer, so it costs nothing per use, but it needs a one-time download first."
      back={() => goBack('voices')}
      skip={offering ? { label: 'Later', run: later } : undefined}
      next={
        offering
          ? { label: 'Download now', run: () => void start(), disabled: !status, loading: starting }
          : { label: 'Continue', run: () => goNext('voices') }
      }
    >
      {!status || !offer ? (
        <div className="min-h-[160px]" aria-busy />
      ) : offer.kind === 'ready' ? (
        <Notice tone="success">Read aloud is ready: the voices are already downloaded on this computer.</Notice>
      ) : offer.kind === 'cant-run' ? (
        <Notice>
          {offer.why} Read aloud needs an NVIDIA graphics card (RTX 20 series or newer) with at least {CARD_GB} GB of memory, so there’s
          nothing to download here. If that changes, you’ll find it in {IN_SETTINGS}.
        </Notice>
      ) : offer.kind === 'downloading' ? (
        <div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            It carries on in the background while you finish setting up. {IN_SETTINGS} shows how it’s going.
          </p>
          <DownloadFor kind="voices" status={status} />
          <DownloadFor kind="studio" status={status} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Card className="divide-y divide-line">
            {status.installed.voices ? null : (
              <Part icon={<AudioLines size={16} />} title="The voices" size={KINDS.voices.size}>
                A voice of their own for the narrator and each character, made from a description (Breeze TTS 2).
              </Part>
            )}
            <Part icon={<Users size={16} />} title="The studio voices" size={KINDS.studio.size}>
              96 real voices recorded in a studio, which characters can be given instead.
            </Part>
          </Card>
          {status.installed.voices ? null : <p className="text-[12.5px] leading-relaxed text-muted">{VOICES_NEEDS}</p>}
          <p className="text-[12.5px] leading-relaxed text-muted">Not now? Choose Later, and download it any time in {IN_SETTINGS}.</p>
        </div>
      )}
    </StepFrame>
  )
}

/** One part of the download: what it is, and its size. */
function Part({ icon, title, size, children }: { icon: React.ReactNode; title: string; size: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-medium text-fg">{title}</span>
          <span className="text-[12px] text-faint">{size}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  )
}
