// The first run's third step (milestone 6): pick the writer model, with Settings › Models' own picker and
// "chosen model" card. A recommended model is shown with a "Use this" button; it is never chosen silently.

import { PenLine, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ModelChoice, ModelInfo, ProviderConfig } from '@shared/types'
import { Badge, Button, Card, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { pricePerMillion } from '@/features/generate/format'
import { ChosenModel, ModelPicker, useConnectionTests } from '@/features/settings/ModelsSettings'
import { recommendWriter } from './setupLogic'
import { goBack, goNext, StepFrame } from './StepFrame'

/** A model from a provider's list as Settings › Models saves it. */
const choiceOf = (providerId: string, m: ModelInfo): ModelChoice => ({
  providerId,
  modelId: m.id,
  label: m.name,
  contextLength: m.contextLength,
  promptPrice: m.promptPrice,
  completionPrice: m.completionPrice,
  maxOutput: m.maxOutput ?? null,
  sampling: m.sampling ?? null
})

export function ModelStep(): React.JSX.Element {
  const { providers, results, test, clearResult } = useConnectionTests()
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const [picking, setPicking] = useState(false)
  const writerProvider = writer && providers ? (providers.find((p) => p.id === writer.providerId) ?? null) : null
  const chosen = writer && writerProvider ? writer : null

  const choose = async (choice: ModelChoice): Promise<void> => {
    try {
      await useApp.getState().updateSettings({ models: { writer: choice } })
      setPicking(false)
      clearResult('writer')
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <StepFrame
      title="Pick a writer model"
      intro="The writer model drafts your scenes. Models with better prose usually cost more per word. You can change it any time in Settings › Models, and give other jobs (the memory, the builders) their own."
      back={() => goBack('model')}
      skip={chosen ? undefined : { label: 'Skip for now', run: () => goNext('model') }}
      next={{ label: 'Continue', run: () => goNext('model'), disabled: !chosen }}
    >
      {!providers ? (
        <div className="min-h-[200px]" aria-busy />
      ) : !providers.length ? (
        <Notice>
          Connect an AI service first (go Back), then pick the model that writes your scenes here. Or skip this and choose it later in
          Settings › Models.
        </Notice>
      ) : chosen && writerProvider && !picking ? (
        <ChosenModel
          job="writer"
          choice={chosen}
          provider={writerProvider}
          icon={<PenLine size={16} />}
          result={results.writer}
          onTest={() => void test('writer', chosen.providerId, chosen.modelId)}
          onChange={() => setPicking(true)}
        />
      ) : (
        <Choosing providers={providers}>
          {(pick, provider) => (
            <div className="flex flex-col gap-4">
              {pick ? <Recommended pick={pick} provider={provider} current={chosen} onUse={(c) => void choose(c)} /> : null}
              <ModelPicker
                providers={providers}
                providerResults={results}
                current={chosen}
                autoFocus={picking}
                onChoose={(c) => void choose(c)}
                onCancel={chosen ? () => setPicking(false) : undefined}
              />
            </div>
          )}
        </Choosing>
      )}
    </StepFrame>
  )
}

/**
 * Works out the model AI Write suggests for writing, from the first connected provider's list (OpenRouter first),
 * before showing the picker, so nothing moves when the suggestion arrives. Null when no model on the list fits.
 */
function Choosing({
  providers,
  children
}: {
  providers: ProviderConfig[]
  children: (pick: { model: ModelInfo; why: string } | null, provider: ProviderConfig) => React.JSX.Element
}): React.JSX.Element {
  const provider = providers.find((p) => p.kind === 'openrouter' && p.hasKey) ?? providers[0]
  const [pick, setPick] = useState<{ model: ModelInfo; why: string } | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    setPick(undefined)
    api
      .listModels(provider.id)
      .then((models) => live && setPick(recommendWriter(models)))
      .catch(() => live && setPick(null))
    return () => {
      live = false
    }
  }, [provider.id])

  return pick === undefined ? <div className="min-h-[420px]" aria-busy /> : children(pick, provider)
}

/** The suggested writer model, with "Use this". */
function Recommended({
  pick,
  provider,
  current,
  onUse
}: {
  pick: { model: ModelInfo; why: string }
  provider: ProviderConfig
  current: ModelChoice | null
  onUse: (c: ModelChoice) => void
}): React.JSX.Element {
  const m = pick.model
  const same = current?.providerId === provider.id && current.modelId === m.id
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-fg" title={m.id}>
              {m.name}
            </span>
            <Badge tone="accent" className="shrink-0">
              Recommended
            </Badge>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            {pick.why}
            {m.promptPrice != null && m.completionPrice != null
              ? ` ${pricePerMillion(m.promptPrice)} in, ${pricePerMillion(m.completionPrice)} out per million tokens.`
              : ''}
          </p>
        </div>
        <Button size="sm" variant="primary" className="shrink-0" disabled={same} onClick={() => onUse(choiceOf(provider.id, m))}>
          {same ? 'Chosen' : 'Use this'}
        </Button>
      </div>
    </Card>
  )
}
