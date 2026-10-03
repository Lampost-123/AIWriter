// Settings › Sound effects: downloading the sound effects model (Stable Audio Open, with CLAP to pick the best of
// each sound's takes), its progress and problems, and whether it is ready. Owned by the Speech engine part; the
// Sound effects section places it. Made of the speech engine's own download pieces (SpeechEngineSettings.tsx), so
// it looks and behaves the same: Download, progress, Cancel, Try again, the licence and the Hugging Face key.
//
// Stable Audio Open's licence (Stability AI Community License) asks for a visible credit: the card always shows it.
import { CircleAlert, CircleCheck, Download, ExternalLink, Waves } from 'lucide-react'
import type { SpeechStatus } from '@shared/contracts/speech'
import { Badge, Button, Card } from '@/components/ui'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import {
  download,
  DownloadFor,
  HuggingFaceKey,
  isPending,
  KeysPageLink,
  KINDS,
  linkClass,
  LoadProblem,
  Row,
  standIn
} from './SpeechEngineSettings'
import { useSpeechStatus } from './useSpeechStatus'
import { SOUNDS_NEEDS, soundsChecks } from './voiceNeeds'

/** Where Stable Audio Open's licence is accepted. */
export const SOUNDS_PAGE = 'https://huggingface.co/stabilityai/stable-audio-open-1.0'

/** The credit Stable Audio Open's licence asks for, wherever the sound effects are offered. */
export const SOUNDS_CREDIT = 'Sound effects are made with Stable Audio Open. Powered by Stability AI.'

/** The sound effects' download card. No props: it follows the speech engine's status itself. */
export function SoundsDownload(): React.JSX.Element {
  const status = useSpeechStatus({ poll: true })
  const runServer = useApp((s) => !!s.settings?.speech?.runServer)
  // Drawn hidden until the status is known (it usually is already), so nothing below it jumps.
  const shown = status ?? standIn(runServer)
  return (
    <Card className={cn(!status && 'invisible')} aria-hidden={status ? undefined : true}>
      <Sounds status={shown} />
    </Card>
  )
}

function Sounds({ status }: { status: SpeechStatus }): React.JSX.Element {
  const installed = !!status.installed.sounds
  const pending = isPending(status, 'sounds')
  // A download that stopped has its own Try again.
  const stopped = status.download?.kind === 'sounds' && status.download.state !== 'done'
  const offer = !installed && !pending && !stopped
  // What this computer has, said before the download starts (during one, the disk fills as it goes).
  const checks = offer ? soundsChecks(status) : []
  const fallsShort = checks.some((c) => !c.ok)
  const problem = pending || stopped ? null : (status.loadProblems.sounds ?? null)
  // The speech engine downloads first when it isn't there yet: its progress and problems (Python to install, say)
  // show here too, since this is where the download was asked for.
  const engineFirst = !status.installed.server && (status.download?.kind === 'server' || status.queued.includes('server'))
  return (
    <Row icon={<Waves size={16} />} title="Sound effects model" badge={installed ? <Badge tone="success">Downloaded</Badge> : null}>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        Stable Audio Open makes each sound on this computer the first time a scene needs it, and AI Write keeps it for next time.
      </p>
      {installed ? <Readiness status={status} /> : <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{SOUNDS_NEEDS}</p>}
      {checks.length ? (
        <ul className="mt-2 space-y-1" aria-label="This computer">
          {checks.map((c) => (
            <li key={c.text} className={cn('flex items-start gap-1.5 text-[12.5px] leading-5', c.ok ? 'text-muted' : 'text-fg')}>
              {c.ok ? (
                <CircleCheck size={13} aria-hidden className="mt-[3px] shrink-0 text-success" />
              ) : (
                <CircleAlert size={13} aria-hidden className="mt-[3px] shrink-0 text-danger" />
              )}
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <LoadProblem
          problem={problem}
          repair={
            <Button size="sm" icon={<Download size={13} />} onClick={() => void download('sounds')}>
              Download the sound effects again
            </Button>
          }
        />
      ) : null}
      {offer ? status.hfKey ? <Offer fallsShort={fallsShort} /> : <LicenceFirst /> : null}
      {engineFirst ? <DownloadFor kind="server" status={status} /> : null}
      <DownloadFor kind="sounds" status={status} />
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{SOUNDS_CREDIT}</p>
    </Row>
  )
}

/** A Hugging Face key is saved: one button. */
function Offer({ fallsShort }: { fallsShort: boolean }): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={fallsShort ? 'secondary' : 'primary'}
        icon={<Download size={13} />}
        onClick={() => void download('sounds')}
      >
        Download the sound effects ({KINDS.sounds.size})
      </Button>
    </div>
  )
}

/**
 * No Hugging Face key yet: Stable Audio Open can't download without one, from an account that accepted its licence.
 * The two steps, and the key box, whose button saves the key and starts the download.
 */
function LicenceFirst(): React.JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/60 p-3 text-[13px] leading-relaxed">
      <p className="font-medium text-fg">Stable Audio Open asks you to accept its licence on Hugging Face first.</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted">
        <li>
          Open{' '}
          <a href={SOUNDS_PAGE} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1', linkClass)}>
            Stable Audio Open’s page on Hugging Face
            <ExternalLink size={12} />
          </a>
          , sign in, and click Agree.
        </li>
        <li>
          <KeysPageLink>Make a key on Hugging Face</KeysPageLink> (read access is enough) and paste it below. The same key works for
          the voices.
        </li>
      </ol>
      <div className="mt-3">
        <HuggingFaceKey compact onSaved={() => void download('sounds')} action="Save key and download" />
      </div>
    </div>
  )
}

/** Downloaded: whether sounds can be made now, in a line. */
function Readiness({ status }: { status: SpeechStatus }): React.JSX.Element {
  const ready = status.server === 'connected' && !!status.soundsReady && !status.loadProblems.sounds
  let text = 'Ready'
  if (status.server !== 'connected') text = 'Sounds are made while the speech engine is running.'
  else if (status.loadProblems.sounds) text = 'Couldn’t load'
  else if (!status.soundsReady) text = 'Not ready'
  else if (status.loaded.sounds) text = 'Ready, loaded'
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] leading-5 text-muted">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ready ? 'bg-success' : 'bg-line-strong')} />
      {text}
    </p>
  )
}
