// What the voices (Breeze TTS 2) need from this computer, said before they download, and whether this computer
// has it. Owned by the Speech engine part. The needs come from the speech server: PyTorch's CUDA 12.8 build
// (NVIDIA only, the RTX 20 series or newer: speech-server/tools/install.py, src/main/speech/status.ts), about
// 8 GB of the graphics card while loaded (speech-server/app/config.py), the processor when there is no card
// (far too slow: speech-server/app/workers/breeze.py), and about 12 GB on disk once downloaded, plus PyTorch's
// 3 GB download kept in the cache until the download finishes (src/main/speech/plan.ts).
import type { SpeechStatus } from '@shared/contracts/speech'

/** The graphics card memory the voices hold while loaded, in GB. */
export const CARD_GB = 8
/** The oldest cards PyTorch's CUDA 12.8 build runs on: compute capability 7.5, the RTX 20 series. */
export const OLDEST_CARD = 7.5
/** Free disk space the download needs while it runs, in GB (about 12 GB kept, plus the 3 GB cache it clears after). */
export const DISK_GB = 15

/** What the voices need, in plain words, shown before they download. */
export const VOICES_NEEDS =
  `They need an NVIDIA graphics card (RTX 20 series or newer) with at least ${CARD_GB} GB of memory. Without one they ` +
  `run on the processor, far too slowly for reading aloud. They take about 12 GB of disk space, and need about ` +
  `${DISK_GB} GB free while they download.`

/** One thing checked on this computer: what was found, and whether it is enough. */
export interface NeedCheck {
  ok: boolean
  text: string
}

const GIB = 1024 ** 3

/** "16 GB" from MiB (nvidia-smi's 8192 for an 8 GB card). */
const cardGb = (mb: number): string => `${Math.round(mb / 1024)} GB`


/**
 * What this computer has for the voices, as far as AI Write can tell: the graphics card, then the free disk
 * space. Anything not known yet (or that couldn't be read) is left out rather than guessed.
 */
export function voicesChecks(
  s: Pick<SpeechStatus, 'nvidia' | 'nvidiaMemoryMb' | 'nvidiaComputeCap' | 'freeSpace'>
): NeedCheck[] {
  const out: NeedCheck[] = []
  const name = s.nvidia
  if (name === '') {
    out.push({ ok: false, text: 'No NVIDIA graphics card was found on this computer, so the voices would be far too slow here.' })
  } else if (name) {
    const memory = s.nvidiaMemoryMb ?? null
    const cap = s.nvidiaComputeCap ?? null
    if (cap !== null && cap < OLDEST_CARD) {
      out.push({ ok: false, text: `This computer’s ${name} is too old for the voices: they need an RTX card, the 20 series or newer.` })
    } else if (memory !== null && memory < CARD_GB * 1024 - 512) {
      out.push({
        ok: false,
        text: `This computer’s ${name} has ${cardGb(memory)} of memory, and the voices need about ${CARD_GB} GB, so they won’t fit on it.`
      })
    } else {
      out.push({ ok: true, text: memory !== null ? `${name} with ${cardGb(memory)} of memory` : name })
    }
  }
  const free = s.freeSpace ?? null
  if (free !== null) {
    out.push(
      free < DISK_GB * GIB
        ? {
            ok: false,
            // Rounded down, so it never reads as more than is there.
            text: `${free < GIB ? 'Less than 1 GB' : `Only ${Math.floor(free / GIB)} GB`} is free on the disk the voices go on, and they need about ${DISK_GB} GB. Free up some space first.`
          }
        : { ok: true, text: `${Math.round(free / GIB)} GB free on the disk` }
    )
  }
  return out
}
