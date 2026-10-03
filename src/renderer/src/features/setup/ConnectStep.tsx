// The first run's second step (milestone 6): connect OpenRouter with a key and test it, or another provider. The
// cards are Settings › Models' own (OpenRouterCard, OtherProviders), so the key is kept the same way (encrypted, in
// the main process, never in a world) and tested by the same code.

import { ExternalLink } from '@/components/ui/icons'
import { useState } from 'react'
import { Notice } from '@/components/ui'
import { OpenRouterCard, OtherProviders, useConnectionTests } from '@/features/settings/ModelsSettings'
import { goBack, goNext, StepFrame } from './StepFrame'

export function ConnectStep(): React.JSX.Element {
  const { providers, loadError, reload, results, test, clearResult } = useConnectionTests()
  const [other, setOther] = useState(false)
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
