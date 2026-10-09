// The first run's second step (milestone 6): connect OpenRouter with a key and test it, or another provider. The
// cards are Settings › Models' own (OpenRouterCard, OtherProviders), so the key is kept the same way (encrypted, in
// the main process, never in a world) and tested by the same code.

import { ExternalLink, Plus } from '@/components/ui/icons'
import { useState } from 'react'
import { Notice } from '@/components/ui'
import { OpenRouterCard, OtherProviders, PRESETS, useConnectionTests } from '@/features/settings/ModelsSettings'
import { ProviderMark } from '@/features/settings/ProviderMark'
import { useNewLook } from '@/features/look/look'
import { goBack, goNext, StepFrame } from './StepFrame'

export function ConnectStep(): React.JSX.Element {
  const { providers, loadError, reload, results, test, clearResult } = useConnectionTests()
  const [other, setOther] = useState(false)
  // The New look: the service picked from the marks, filled in on the form.
  const [preset, setPreset] = useState<string | undefined>(undefined)
  const isNew = useNewLook()
  const openrouter = providers?.find((p) => p.kind === 'openrouter') ?? null
  const custom = providers?.filter((p) => p.kind === 'custom') ?? []
  // Something to write with: a saved OpenRouter key, or another provider (one on this computer needs no key).
  const connected = !!openrouter?.hasKey || custom.length > 0

  return (
    <StepFrame
      title="Connect an AI service"
      intro="AI Write reaches the AI models that draft your scenes and keep the memory through a service. OpenRouter is the simplest: one key reaches hundreds of models, each with its price shown, and you pay only for what you use."
      back={() => goBack('connect')}
      skip={connected ? undefined : { label: 'Skip for now', run: () => goNext('connect') }}
      next={{ label: 'Continue', run: () => goNext('connect'), disabled: !connected }}
    >
      {loadError && !providers ? (
        <Notice tone="danger">Couldn’t load your providers. {loadError}</Notice>
      ) : !providers ? (
        <div className="min-h-[220px]" aria-busy />
      ) : (
        <div className="flex flex-col gap-5">
          <OpenRouterCard
            provider={openrouter}
            result={openrouter ? results[openrouter.id] : undefined}
            onTest={(id) => void test(id, id)}
            onClearResult={clearResult}
            onChanged={reload}
          />
          {openrouter?.hasKey ? null : (
            <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
              <p className="font-medium text-fg">Getting a key takes a couple of minutes</p>
              <ol className="mt-1 list-decimal pl-5">
                <li>
                  Sign up at{' '}
                  <a
                    href="https://openrouter.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent underline decoration-accent/50 underline-offset-2 hover:text-accent-hover"
                  >
                    openrouter.ai
                    <ExternalLink size={11} aria-hidden />
                  </a>
                  .
                </li>
                <li>Add a little credit (a few dollars goes a long way).</li>
                <li>Under Keys, create a key, copy it and paste it above. Connect tests it straight away.</li>
              </ol>
            </div>
          )}
          {other || custom.length ? (
            <OtherProviders
              providers={custom}
              results={results}
              onTest={(id) => void test(id, id)}
              onClearResult={clearResult}
              onChanged={reload}
              startAdding={other && !custom.length}
              startPreset={preset}
            />
          ) : isNew ? (
            <OtherServices
              onPick={(name) => {
                setPreset(name)
                setOther(true)
              }}
            />
          ) : (
            <div>
              <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setOther(true)}>
                Use another provider
              </button>
              <span className="text-[12.5px] text-faint"> such as OpenAI, DeepSeek, or LM Studio on this computer</span>
            </div>
          )}
        </div>
      )}
    </StepFrame>
  )
}

/**
 * The New look: the other services as a row of marks (generic shapes, never their logos), each starting the Add a
 * provider form filled in for it, and "Use another provider" for any other.
 */
function OtherServices({ onPick }: { onPick: (preset?: string) => void }): React.JSX.Element {
  return (
    <section aria-label="Other services" className="setup-services">
      <p className="mb-2 text-[12.5px] text-muted">Or use another service, or models running on this computer:</p>
      <div className="grid grid-cols-2 gap-2 min-[1500px]:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onPick(p.name)}
            className="setup-service flex items-center gap-2.5 rounded-[12px] bg-raise px-2.5 py-2 text-left shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)] transition-[box-shadow,translate,scale] duration-(--dur-quick) ease-glide hover:-translate-y-px hover:shadow-[var(--elev-2),inset_0_0_0_1px_var(--line-strong)] active:scale-[0.98] active:duration-(--dur-press)"
          >
            <ProviderMark kind="custom" name={p.name} baseUrl={p.baseUrl} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-fg">{p.name}</span>
              <span className="block truncate text-[11.5px] text-faint">{p.needsKey ? 'Needs a key' : 'On this computer'}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPick(undefined)}
          className="flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-accent shadow-[inset_0_0_0_1px_var(--line)] [border:1px_dashed_transparent] transition-[background-color,scale] duration-(--dur-quick) ease-glide hover:bg-surface-2 active:scale-[0.98] active:duration-(--dur-press)"
        >
          <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] bg-accent-soft">
            <Plus size={15} />
          </span>
          <span className="text-[13px] font-medium">Use another provider</span>
        </button>
      </div>
    </section>
  )
}
