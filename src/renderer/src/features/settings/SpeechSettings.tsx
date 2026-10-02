// Settings › Read aloud and dictation (milestone 4): the everyday choices on top (the speech engine,
// reading aloud with the narrator's voice and speed, the dictation key) and the rest under More. Each
// part fills its own sections (features/speech, features/readAloud, features/dictation).
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { SpeechEngineSettings } from '@/features/speech/SpeechEngineSettings'
import { ReadAloudSettings } from '@/features/readAloud/ReadAloudSettings'
import { DictationSettings } from '@/features/dictation/DictationSettings'

export function SpeechSettings(): React.JSX.Element {
  const [more, setMore] = useState(false)
  return (
    <div className="flex flex-col gap-8">
      <SpeechEngineSettings section="everyday" />
      <ReadAloudSettings section="everyday" />
      <DictationSettings section="everyday" />
      <div className="border-t border-line pt-4">
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
          className="-mx-1 flex h-8 items-center gap-1.5 rounded-md px-1 text-[13.5px] font-medium text-muted outline-none transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronRight size={15} className={cn('transition-transform duration-150', more && 'rotate-90')} aria-hidden />
          More
        </button>
        {more ? (
          <div className="mt-4 flex flex-col gap-8 animate-fade-in">
            <ReadAloudSettings section="more" />
            <DictationSettings section="more" />
            <SpeechEngineSettings section="more" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
