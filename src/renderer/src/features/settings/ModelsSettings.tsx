// Settings › Models: connect OpenRouter or another provider, test it, and pick the writer model
// and, if Adam wants others, the memory, character builder, world builder, chat and brainstorm, consistency
// check and read aloud models.
// Keys are sent to the main process once and never come back.
import { AudioLines, Check, CookingPot, Globe2, ListChecks, KeyRound, MessagesSquare, NotebookText, PenLine, Plus, Search, Server, UserRoundPen } from '@/components/ui/icons'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Creativity, DeepPartial, ID, ModelChoice, ModelInfo, ProviderConfig, Settings, ThinkingJob, ThinkingLevel } from '@shared/types'
import { CREATIVITY_PRESETS, OPENROUTER_BASE_URL } from '@shared/defaults'
import { isLocalUrl } from '@shared/urls'
import { Badge, Button, Card, Field, Input, Notice, Select, SettingsSection, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { PlanSettings } from '@/features/plan/PlanSettings'
import { cn } from '@/lib/cn'
import { CREATIVITY_HINTS, THINKING_LABELS, filterModels, formatContext, pricePerMillion } from '@/features/generate/format'
import { Segmented, Skeleton, useDelayed } from '@/features/generate/parts'
import { RepairSettings } from '@/features/repair/RepairSettings'

export type TestResult = { state: 'testing' } | { state: 'done'; ok: boolean; message: string }

const PRESETS: { name: string; baseUrl: string; needsKey: boolean }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false }
]

const CREATIVITY_OPTIONS = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).map((k) => ({ value: k, label: CREATIVITY_PRESETS[k].label }))
const MAX_ROWS = 150

async function refreshSettings(): Promise<void> {
  useApp.setState({ settings: await api.getSettings() })
}

/**
 * The providers and this visit's connection tests (by provider id, or by job for a model's test). Shared with the
 * first-run setup (milestone 6), which shows the same cards.
 */
export function useConnectionTests(): {
  providers: ProviderConfig[] | null
  loadError: string | null
  reload: () => Promise<void>
  results: Record<string, TestResult>
  test: (key: string, providerId: ID, modelId?: string) => Promise<void>
  clearResult: (key: string) => void
} {
  const [providers, setProviders] = useState<ProviderConfig[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})

  const reload = useCallback(async () => {
    try {
      setProviders(await api.listProviders())
      setLoadError(null)
      await refreshSettings()
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const test = useCallback(async (key: string, providerId: ID, modelId?: string) => {
    setResults((r) => ({ ...r, [key]: { state: 'testing' } }))
    try {
      const res = await api.testProvider(providerId, modelId)
      setResults((r) => ({ ...r, [key]: { state: 'done', ok: res.ok, message: res.message } }))
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { state: 'done', ok: false, message: (e as Error).message } }))
    }
  }, [])
  const clearResult = useCallback(
    (key: string): void =>
      setResults((r) => {
        const n = { ...r }
        delete n[key]
        return n
      }),
    []
  )
  return { providers, loadError, reload, results, test, clearResult }
}

export function ModelsSettings(): React.JSX.Element {
  const { providers, loadError, reload, results, test, clearResult } = useConnectionTests()
  const readAloud = useApp((s) => !!s.settings?.speech?.readAloud)

  if (loadError && !providers) {
    return (
      <Notice tone="danger" action={<Button size="sm" onClick={() => void reload()}>Try again</Button>}>
        Couldn't load your providers. {loadError}
      </Notice>
    )
  }
  if (!providers) return <div className="min-h-[480px]" aria-busy />

  const openrouter = providers.find((p) => p.kind === 'openrouter') ?? null
  const custom = providers.filter((p) => p.kind === 'custom')

  return (
    <div className="flex flex-col gap-9 animate-fade-in">
      <OpenRouterCard provider={openrouter} result={openrouter ? results[openrouter.id] : undefined} onTest={(id) => void test(id, id)} onClearResult={clearResult} onChanged={reload} />
      <OtherProviders providers={custom} results={results} onTest={(id) => void test(id, id)} onClearResult={clearResult} onChanged={reload} />
      <WriterModel
        providers={providers}
        result={results.writer}
        providerResults={results}
        onTest={(pid, mid) => void test('writer', pid, mid)}
        onClearResult={() => clearResult('writer')}
      />
      <HelperModel
        job="memory"
        providers={providers}
        result={results.memory}
        providerResults={results}
        onTest={(pid, mid) => void test('memory', pid, mid)}
        onClearResult={() => clearResult('memory')}
      />
      <HelperModel
        job="builder"
        providers={providers}
        result={results.builder}
        providerResults={results}
        onTest={(pid, mid) => void test('builder', pid, mid)}
        onClearResult={() => clearResult('builder')}
      />
      <HelperModel
        job="world"
        providers={providers}
        result={results.world}
        providerResults={results}
        onTest={(pid, mid) => void test('world', pid, mid)}
        onClearResult={() => clearResult('world')}
      />
      <HelperModel
        job="chat"
        providers={providers}
        result={results.chat}
        providerResults={results}
        onTest={(pid, mid) => void test('chat', pid, mid)}
        onClearResult={() => clearResult('chat')}
      />
      <HelperModel
        job="check"
        providers={providers}
        result={results.check}
        providerResults={results}
        onTest={(pid, mid) => void test('check', pid, mid)}
        onClearResult={() => clearResult('check')}
      />
      <HelperModel
        job="recipe"
        providers={providers}
        result={results.recipe}
        providerResults={results}
        onTest={(pid, mid) => void test('recipe', pid, mid)}
        onClearResult={() => clearResult('recipe')}
      />
      {/* Only once read aloud is on: until then it has nothing to do, so it doesn't crowd the page. */}
      {readAloud ? (
        <HelperModel
          job="speech"
          providers={providers}
          result={results.speech}
          providerResults={results}
          onTest={(pid, mid) => void test('speech', pid, mid)}
          onClearResult={() => clearResult('speech')}
        />
      ) : null}
      <DefaultCreativity />
      {/* Before writing and straight after: the plan, then the check of the new words. */}
      <PlanSettings />
      <RepairSettings />
    </div>
  )
}

// ---------- Pieces ----------

export function ResultNotice({ result }: { result: TestResult | undefined }): React.JSX.Element | null {
  if (!result) return null
  if (result.state === 'testing') {
    return (
      <Notice>
        <span className="flex items-center gap-2 text-muted">
          <Spinner size={13} /> Testing the connection…
        </span>
      </Notice>
    )
  }
  return <Notice tone={result.ok ? 'success' : 'danger'}>{result.message}</Notice>
}

/** Whether the provider works: this visit's test if there was one, else the last check remembered. Undefined when nothing has been checked. */
function checkOf(provider: ProviderConfig | null, result: TestResult | undefined): boolean | undefined {
  if (result?.state === 'done') return result.ok
  return provider?.lastCheck?.ok
}

function IconTile({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'neutral' }): React.JSX.Element {
  return (
    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>
      {children}
    </div>
  )
}

// ---------- OpenRouter ----------

export function OpenRouterCard({
  provider,
  result,
  onTest,
  onClearResult,
  onChanged
}: {
  provider: ProviderConfig | null
  result: TestResult | undefined
  onTest: (id: ID) => void
  onClearResult: (id: ID) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = !!provider?.hasKey
  const showForm = !connected || replacing
  // "Connected" only once a test has shown it works; a key that was only saved says just that.
  const check = checkOf(provider, result)

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim()) {
      setError('Paste your OpenRouter key first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const p = await api.saveProvider({ id: provider?.id, kind: 'openrouter', name: 'OpenRouter', baseUrl: OPENROUTER_BASE_URL, apiKey: key.trim() })
      setKey('')
      setReplacing(false)
      await onChanged()
      onTest(p.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    if (!provider) return
    const id = provider.id
    try {
      await api.deleteProvider(id)
      onClearResult(id)
      await onChanged()
      toast('OpenRouter disconnected and its key removed.', {
        action: {
          label: 'Undo',
          run: () =>
            void api
              .restoreProvider(id)
              .then(onChanged)
              .catch((err: Error) => toast(err.message, { tone: 'danger' }))
        }
      })
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' })
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <IconTile>
          <KeyRound size={17} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-fg">OpenRouter</h2>
            {!connected ? (
              <Badge tone="accent">Recommended</Badge>
            ) : check === true ? (
              <Badge tone="success">Connected</Badge>
            ) : check === false ? (
              <Badge tone="danger">Not working</Badge>
            ) : (
              <Badge>Key saved</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            One key for hundreds of models, each with its price shown up front. Make a key at{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-accent/50 underline-offset-2 transition-colors duration-150 hover:text-accent-hover hover:decoration-accent"
            >
              openrouter.ai/keys
            </a>{' '}
            and paste it here.
          </p>
        </div>
      </div>

      {showForm ? (
        <form onSubmit={(e) => void save(e)} className="mt-4 flex items-start gap-2 pl-12">
          <Field label={replacing ? 'New API key' : 'API key'} className="flex-1" error={error}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-v1-…"
                value={key}
                autoFocus={replacing}
                onChange={(e) => {
                  setKey(e.target.value)
                  setError(null)
                }}
              />
            )}
          </Field>
          <div className="mt-[21px] flex gap-2">
            <Button type="submit" variant="primary" loading={saving}>
              {replacing ? 'Save key' : 'Connect'}
            </Button>
            {replacing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReplacing(false)
                  setKey('')
                  setError(null)
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        // The three buttons always stay together on one row; in a narrow window they go under the sentence.
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 pl-12">
          <span className="min-w-[200px] flex-1 text-[12.5px] text-muted">Your key is saved on this computer, encrypted.</span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => provider && onTest(provider.id)} loading={result?.state === 'testing'}>
              Test connection
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
              Replace key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
      {result ? (
        <div className="mt-3 pl-12">
          <ResultNotice result={result} />
        </div>
      ) : null}
    </Card>
  )
}

// ---------- Other providers ----------

export function OtherProviders({
  providers,
  results,
  onTest,
  onClearResult,
  onChanged,
  startAdding = false
}: {
  providers: ProviderConfig[]
  results: Record<string, TestResult>
  onTest: (id: ID) => void
  onClearResult: (id: ID) => void
  onChanged: () => Promise<void>
  /** Opens with the Add a provider form showing (the first-run setup's "Use another provider"). */
  startAdding?: boolean
}): React.JSX.Element {
  const [adding, setAdding] = useState(startAdding)
  const [editing, setEditing] = useState<ID | null>(null)

  const remove = async (p: ProviderConfig): Promise<void> => {
    try {
      await api.deleteProvider(p.id)
      onClearResult(p.id)
      await onChanged()
      toast(`${p.name} removed.`, {
        action: {
          label: 'Undo',
          run: () =>
            void api
              .restoreProvider(p.id)
              .then(onChanged)
              .catch((err: Error) => toast(err.message, { tone: 'danger' }))
        }
      })
    } catch (err) {
      toast((err as Error).message, { tone: 'danger' })
    }
  }

  return (
    <SettingsSection
      title="Other providers"
      description="Any service that works like OpenAI's: OpenAI, DeepSeek, Mistral, Groq and others, or models running on this computer through LM Studio or Ollama."
    >
      <div className="flex flex-col gap-2">
        {providers.map((p) =>
          editing === p.id ? (
            <ProviderForm
              key={p.id}
              initial={p}
              onCancel={() => setEditing(null)}
              onSaved={async (saved) => {
                setEditing(null)
                await onChanged()
                onTest(saved.id)
              }}
            />
          ) : (
            <Card key={p.id} className="px-4 py-3">
              {/* In a narrow window the buttons move under the name rather than squeezing it. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <IconTile tone="neutral">
                  <Server size={16} />
                </IconTile>
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-fg" title={p.name}>
                      {p.name}
                    </span>
                    {checkOf(p, results[p.id]) === false ? (
                      <Badge tone="danger" className="shrink-0">
                        Not working
                      </Badge>
                    ) : (
                      <Badge className="shrink-0">{p.hasKey ? 'Key saved' : 'No key'}</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 break-all font-mono text-[12px] text-faint">{p.baseUrl}</div>
                </div>
                <div className="ml-auto flex shrink-0 gap-1">
                  <Button size="sm" onClick={() => onTest(p.id)} loading={results[p.id]?.state === 'testing'}>
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(p)}>
                    Remove
                  </Button>
                </div>
              </div>
              {results[p.id] ? (
                <div className="mt-3 pl-12">
                  <ResultNotice result={results[p.id]} />
                </div>
              ) : null}
            </Card>
          )
        )}
        {adding ? (
          <ProviderForm
            onCancel={() => setAdding(false)}
            onSaved={async (saved) => {
              setAdding(false)
              await onChanged()
              onTest(saved.id)
            }}
          />
        ) : (
          <div>
            <Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>
              Add another provider
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

function ProviderForm({
  initial,
  onSaved,
  onCancel
}: {
  initial?: ProviderConfig
  onSaved: (p: ProviderConfig) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Online services need a key; programs on this computer (LM Studio, Ollama) don't.
  const url = baseUrl.trim().replace(/\/+$/, '')
  const preset = PRESETS.find((p) => p.baseUrl === url)
  const keyNeeded = preset ? preset.needsKey : url !== '' && !isLocalUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)
  const willHaveKey = key.trim() !== '' || (!!initial?.hasKey && !removeKey)

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (keyNeeded && !willHaveKey) {
      setError(`Paste your ${name.trim() || 'provider'} API key first. Only programs on this computer, like LM Studio or Ollama, work without one.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveProvider({
        id: initial?.id,
        kind: 'custom',
        name,
        baseUrl,
        apiKey: key.trim() ? key.trim() : removeKey ? '' : initial ? undefined : ''
      })
      await onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 animate-fade-in">
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-fg">{initial ? `Edit ${initial.name}` : 'Add a provider'}</h3>
        </div>
        {!initial ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] text-muted">Fill in for:</span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  // Keep a name Adam typed himself; replace one a preset filled in.
                  if (!name.trim() || PRESETS.some((x) => x.name === name.trim())) setName(p.name)
                  setBaseUrl(p.baseUrl)
                  setError(null)
                }}
                className={cn(
                  'h-6 rounded-full border px-2.5 text-[12px] transition-colors duration-150',
                  baseUrl === p.baseUrl ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-page text-muted hover:border-line-strong hover:text-fg'
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_1.6fr] gap-3">
          <Field label="Name">{(id) => <Input id={id} value={name} placeholder="LM Studio" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Base URL" hint="Usually ends in /v1. LM Studio: http://localhost:1234/v1 · Ollama: http://localhost:11434/v1">
            {(id) => <Input id={id} value={baseUrl} spellCheck={false} placeholder="https://api.example.com/v1" onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-[12.5px]!" />}
          </Field>
        </div>
        <Field
          label={keyNeeded ? 'API key' : 'API key (optional)'}
          hint={
            initial?.hasKey && !removeKey ? (
              <>
                A key is saved. Type a new one to replace it, or{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => setRemoveKey(true)}>
                  remove it
                </button>
                .
              </>
            ) : removeKey ? (
              keyNeeded ? (
                'The saved key will be removed when you save. This service needs one, so paste a new key.'
              ) : (
                'The saved key will be removed when you save.'
              )
            ) : keyNeeded ? (
              preset ? (
                `Paste the key from your ${preset.name} account.`
              ) : (
                'Online services need a key. Leave it empty only for programs on this computer, like LM Studio or Ollama.'
              )
            ) : (
              'Leave empty for programs on this computer, like LM Studio or Ollama.'
            )
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={initial?.hasKey && !removeKey ? '••••••••••••' : ''}
              onChange={(e) => {
                setKey(e.target.value)
                setError(null)
                if (e.target.value) setRemoveKey(false)
              }}
            />
          )}
        </Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {initial ? 'Save changes' : 'Add provider'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ---------- Writer, memory, character builder, world builder, chat and brainstorm, and read aloud models ----------

/**
 * The jobs chosen on this page: the model that drafts scenes, the one that keeps the memory up to date, the
 * character builder's, the world builder's, Ask the world's and the outline helper's (chat and brainstorm),
 * and read aloud's.
 */
export type ModelJob = 'writer' | 'memory' | 'builder' | 'chat' | 'speech' | 'world' | 'check' | 'recipe'
type HelperJob = Exclude<ModelJob, 'writer'>

const setModel = (job: ModelJob, choice: ModelChoice | null): DeepPartial<Settings> => ({ models: { [job]: choice } })

function WriterModel({
  providers,
  result,
  providerResults,
  onTest,
  onClearResult
}: {
  providers: ProviderConfig[]
  result: TestResult | undefined
  /** Each provider's connection test this visit, so a problem already shown above isn't repeated in the list. */
  providerResults: Record<string, TestResult>
  onTest: (providerId: ID, modelId: string) => void
  onClearResult: () => void
}): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const update = useApp((s) => s.updateSettings)
  const [picking, setPicking] = useState(false)
  const writerProvider = writer ? providers.find((p) => p.id === writer.providerId) ?? null : null

  const choose = async (choice: ModelChoice): Promise<void> => {
    try {
      await update(setModel('writer', choice))
      setPicking(false)
      onClearResult()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <SettingsSection title="Writer model" description="The model that drafts your scenes. Pick one with the best prose you can afford; you can switch any time.">
      {!providers.length ? (
        <Notice>Connect OpenRouter or add a provider above, then pick the model that writes your scenes here.</Notice>
      ) : writer && writerProvider && !picking ? (
        <ChosenModel
          job="writer"
          choice={writer}
          provider={writerProvider}
          icon={<PenLine size={16} />}
          result={result}
          onTest={() => onTest(writer.providerId, writer.modelId)}
          onChange={() => setPicking(true)}
        />
      ) : (
        <ModelPicker
          providers={providers}
          providerResults={providerResults}
          current={writer}
          autoFocus={picking}
          onChoose={(c) => void choose(c)}
          onCancel={writer && writerProvider ? () => setPicking(false) : undefined}
        />
      )}
      {providers.length ? (
        <>
          <ThinkingChoice job="writer" about="Thinking can help a model plan a scene, but drafts take longer. Models that don't think aren't affected." />
          {/* The writer model's other jobs, each with its own Thinking: shorter, with the hints shown once above. */}
          <ThinkingChoice
            job="sample"
            title="Thinking for sample passages"
            about="When the writer model writes a sample passage for the style guide. Off is quickest."
            hints={false}
          />
          <ThinkingChoice
            job="polish"
            title="Thinking for the polish pass"
            about="When the writer model polishes a finished draft. Thinking may catch more, but the polish takes longer and costs more."
            hints={false}
          />
        </>
      ) : null}
    </SettingsSection>
  )
}

/**
 * What each helper's section says. Each uses the writer model unless Adam chooses another, except read
 * aloud and the consistency checks, which use the memory model (itself the writer model unless Adam chose one
 * for the memory), and the world builder, which uses the character builder model (the writer model unless Adam chose one).
 */
const HELPERS: Record<
  HelperJob,
  { title: string; description: string; icon: ReactNode; waiting: string; noWriter: string; thinking: string; fallback?: 'memory' | 'builder' }
> = {
  memory: {
    title: 'Memory model',
    description: 'Reads your scenes to keep the memory up to date. A fast, cheaper model is fine.',
    icon: <NotebookText size={16} />,
    waiting: 'Once a provider is connected above, the memory uses the writer model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for the memory here.',
    thinking: "The memory doesn't need to think: Off is quickest, and leaves the model room to answer. It applies even when the memory uses the writer model."
  },
  builder: {
    title: 'Character builder model',
    description: 'Builds characters, places, groups and items from your notes, and answers in character in the interview.',
    icon: <UserRoundPen size={16} />,
    waiting: 'Once a provider is connected above, the character builder uses the writer model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for the character builder here.',
    thinking: 'Off is quickest, and the profile starts filling in straight away. It applies even when the builder uses the writer model.'
  },
  world: {
    title: 'World builder model',
    description: 'Builds the world from a summary you type or paste: its characters, places, lore, events and plot threads.',
    icon: <Globe2 size={16} />,
    waiting: 'Once a provider is connected above, the world builder uses the character builder model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for the world builder here.',
    thinking:
      'Off is quickest, and the world starts filling in straight away. It applies even when the world builder uses the character builder model.',
    fallback: 'builder'
  },
  chat: {
    title: 'Chat and brainstorm model',
    description: 'Answers in Ask the world, suggests outlines, and offers ideas for the next scene.',
    icon: <MessagesSquare size={16} />,
    waiting: 'Once a provider is connected above, chat and brainstorming use the writer model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for chat and brainstorming here.',
    thinking: 'Off is quickest, and answers start straight away. It applies even when chat uses the writer model.'
  },
  check: {
    title: 'Consistency check model',
    description: 'Checks scenes against the memory: facts, who knows what, timeline and place, voices and style.',
    icon: <ListChecks size={16} />,
    waiting: 'Once a provider is connected above, the consistency checks use the memory model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for the consistency checks here.',
    thinking: 'Off is quickest, and checks finish sooner. It applies even when the checks use the memory model.',
    fallback: 'memory'
  },
  recipe: {
    title: 'Recipe maker',
    description:
      'Reads a story you import for a recipe and sums up its themes, writing style and structure. The story is sent only to this model, and only while the recipe is made.',
    icon: <CookingPot size={16} />,
    waiting: 'Once a provider is connected above, the recipe maker uses the memory model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for making recipes here.',
    thinking: 'Off is quickest and cheapest. It applies even when the recipe maker uses the memory model.',
    fallback: 'memory'
  },
  speech: {
    title: 'Read aloud model',
    description: 'Suggests voices for characters and how their names are said. (Who says each line, and how, comes from the writer model.) A fast, cheaper model is fine.',
    icon: <AudioLines size={16} />,
    waiting: 'Once a provider is connected above, read aloud uses the memory model, or one you choose here.',
    noWriter: 'Choose a writer model above, or a model just for reading aloud here.',
    thinking: "Reading aloud doesn't need the model to think: Off is quickest. It applies even when read aloud uses the memory model.",
    fallback: 'memory'
  }
}

/**
 * A helper job's model: the writer model (for read aloud and the consistency checks, the memory model; for the world builder, the
 * character builder model) unless Adam chooses another.
 */
function HelperModel({
  job,
  providers,
  result,
  providerResults,
  onTest,
  onClearResult
}: {
  job: HelperJob
  providers: ProviderConfig[]
  result: TestResult | undefined
  providerResults: Record<string, TestResult>
  onTest: (providerId: ID, modelId: string) => void
  onClearResult: () => void
}): React.JSX.Element {
  const words = HELPERS[job]
  const chosen = useApp((s) => s.settings?.models[job] ?? null)
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const memory = useApp((s) => s.settings?.models.memory ?? null)
  const builder = useApp((s) => s.settings?.models.builder ?? null)
  // What the job uses while Adam hasn't chosen a model for it.
  const fallsBackTo = words.fallback === 'memory' ? 'memory model' : words.fallback === 'builder' ? 'character builder model' : 'writer model'
  const helper = words.fallback === 'memory' ? memory : words.fallback === 'builder' ? builder : null
  const fallbackModel = helper && providers.some((p) => p.id === helper.providerId) ? helper : writer
  const update = useApp((s) => s.updateSettings)
  const [picking, setPicking] = useState(false)
  // A model whose provider has gone isn't used: the job goes back to the writer model.
  const chosenProvider = chosen ? providers.find((p) => p.id === chosen.providerId) ?? null : null
  const own = chosen && chosenProvider ? chosen : null

  const save = async (choice: ModelChoice | null): Promise<void> => {
    try {
      await update(setModel(job, choice))
      setPicking(false)
      onClearResult()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <SettingsSection title={words.title} description={words.description}>
      {!providers.length ? (
        <Notice>{words.waiting}</Notice>
      ) : picking ? (
        <ModelPicker providers={providers} providerResults={providerResults} current={own} autoFocus onChoose={(c) => void save(c)} onCancel={() => setPicking(false)} />
      ) : own && chosenProvider ? (
        <ChosenModel
          job={job}
          choice={own}
          provider={chosenProvider}
          icon={words.icon}
          result={result}
          onTest={() => onTest(own.providerId, own.modelId)}
          onChange={() => setPicking(true)}
          extra={
            <button type="button" onClick={() => void save(null)} className="mt-1.5 text-[12.5px] text-accent hover:underline">
              Use the {fallsBackTo}
            </button>
          }
        />
      ) : (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <IconTile tone="neutral">{words.icon}</IconTile>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-fg">Same as the {fallsBackTo}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted" title={fallbackModel?.modelId}>
                {fallbackModel ? fallbackModel.label || fallbackModel.modelId : words.noWriter}
              </div>
            </div>
            <Button size="sm" className="shrink-0" onClick={() => setPicking(true)}>
              Choose another model
            </Button>
          </div>
        </Card>
      )}
      {providers.length ? <ThinkingChoice job={job} about={words.thinking} /> : null}
      {providers.length && job === 'speech' ? <SoundsThinking /> : null}
    </SettingsSection>
  )
}

/** A chosen model: its name, provider, how much it reads and its price, with Test and Change. */
export function ChosenModel({
  job,
  choice,
  provider,
  icon,
  result,
  onTest,
  onChange,
  extra
}: {
  job: ModelJob
  choice: ModelChoice
  provider: ProviderConfig
  icon: ReactNode
  result: TestResult | undefined
  onTest: () => void
  onChange: () => void
  /** Shown under the model's details. */
  extra?: ReactNode
}): React.JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <IconTile>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-fg" title={choice.modelId}>
            {choice.label || choice.modelId}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {provider.name}
            {choice.contextLength ? ` · reads up to ${formatContext(choice.contextLength)} tokens` : ''}
            {choice.promptPrice != null && choice.completionPrice != null
              ? ` · ${pricePerMillion(choice.promptPrice)} in, ${pricePerMillion(choice.completionPrice)} out per million tokens`
              : ''}
          </div>
          {extra}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" onClick={onTest} loading={result?.state === 'testing'}>
            Test this model
          </Button>
          <Button size="sm" variant="ghost" onClick={onChange}>
            Change
          </Button>
        </div>
      </div>
      {provider.kind === 'custom' || choice.contextLength == null ? (
        <ContextLengthField key={`${choice.providerId}/${choice.modelId}`} job={job} choice={choice} />
      ) : null}
      {result ? (
        <div className="mt-3 pl-12">
          <ResultNotice result={result} />
        </div>
      ) : null}
    </Card>
  )
}

function ContextLengthField({ job, choice }: { job: ModelJob; choice: ModelChoice }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const [text, setText] = useState(choice.contextLength != null ? String(choice.contextLength) : '')
  const [error, setError] = useState<string | null>(null)
  const commit = (): void => {
    const digits = text.replace(/[^\d]/g, '')
    if (!digits) {
      // Cleared: back to "not known", which AI Write treats as 16,000.
      setError(null)
      if (choice.contextLength != null) void update(setModel(job, { ...choice, contextLength: null })).catch(() => undefined)
      return
    }
    const n = parseInt(digits, 10)
    if (n < 1000) {
      setError('That looks too small. Models read at least a few thousand tokens, like 8000 or 32000.')
      return
    }
    setError(null)
    const value = Math.min(n, 10_000_000)
    setText(String(value))
    if (value !== choice.contextLength) void update(setModel(job, { ...choice, contextLength: value })).catch(() => undefined)
  }
  return (
    <div className="mt-4 border-t border-line pt-4 pl-12">
      <Field
        label="How much can this model read at once?"
        error={error}
        hint={
          choice.contextLength == null
            ? "This provider doesn't say. Check the model's page; if you're not sure, leave it and AI Write will assume 16,000 tokens."
            : job === 'writer'
              ? "AI Write fits each briefing to this. Change it if the model's page says it can read more or less."
              : job === 'memory'
                ? "AI Write fits how much of a scene it reads at once to this. Change it if the model's page says it can read more or less."
                : job === 'world'
                  ? "AI Write reads a long summary in parts that fit this. Change it if the model's page says it can read more or less."
                  : job === 'check'
                    ? "AI Write fits how much of a scene it checks at once to this. Change it if the model's page says it can read more or less."
                  : job === 'recipe'
                    ? "AI Write reads a story for a recipe in parts that fit this. Change it if the model's page says it can read more or less."
                  : "AI Write fits what it tells the builder about your world to this. Change it if the model's page says it can read more or less."
        }
      >
        {(id) => (
          <div className="relative w-[200px]">
            <Input
              id={id}
              inputMode="numeric"
              value={text}
              placeholder="16000"
              onChange={(e) => {
                setText(e.target.value.replace(/[^\d]/g, '').slice(0, 8))
                setError(null)
              }}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              className="pr-14 tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">tokens</span>
          </div>
        )}
      </Field>
    </div>
  )
}

export function ModelPicker({
  providers,
  providerResults,
  current,
  autoFocus,
  onChoose,
  onCancel
}: {
  providers: ProviderConfig[]
  providerResults: Record<string, TestResult>
  current: ModelChoice | null
  /** Only when Adam asked to change the model, so opening Settings never jumps the page. */
  autoFocus: boolean
  onChoose: (c: ModelChoice) => void
  onCancel?: () => void
}): React.JSX.Element {
  const [providerId, setProviderId] = useState<ID>(() => (current && providers.some((p) => p.id === current.providerId) ? current.providerId : providers[0].id))
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const ticket = useRef(0)

  const load = useCallback(() => {
    const t = ++ticket.current
    setModels(null)
    setError(null)
    api
      .listModels(provider.id)
      .then((m) => t === ticket.current && setModels(m))
      .catch((e: Error) => t === ticket.current && setError(e.message))
  }, [provider.id])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => filterModels(models ?? [], query), [models, query])
  const shown = filtered.slice(0, MAX_ROWS)
  const typed = query.trim()
  const canUseTyped = provider.kind === 'custom' && typed.length > 1 && !(models ?? []).some((m) => m.id === typed)
  const slow = useDelayed(models === null && !error)
  const tested = providerResults[provider.id]
  const providerFailed = tested?.state === 'done' && !tested.ok

  const pick = (m: ModelInfo): void =>
    onChoose({
      providerId: provider.id,
      modelId: m.id,
      label: m.name,
      contextLength: m.contextLength,
      promptPrice: m.promptPrice,
      completionPrice: m.completionPrice,
      maxOutput: m.maxOutput ?? null,
      // Always set (null: not known), so the previous model's answer is never kept by the settings merge.
      sampling: m.sampling ?? null
    })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line p-3">
        {providers.length > 1 ? (
          <div className="w-[180px] shrink-0">
            <Select
              value={provider.id}
              onChange={(v) => {
                if (v) {
                  setProviderId(v)
                  setQuery('')
                }
              }}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        ) : null}
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            aria-label="Search models"
            placeholder={provider.kind === 'openrouter' ? 'Search models by name or maker' : 'Search models, or type a model name'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            autoFocus={autoFocus}
          />
        </div>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_72px_150px] gap-3 border-b border-line bg-surface-2/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        <span className="pl-6">Model</span>
        <span className="text-right">Reads</span>
        <span className="text-right">Per million tokens</span>
      </div>
      <div className="h-[340px] overflow-auto" role="listbox" aria-label="Models">
        {error ? (
          <div className="p-4">
            {providerFailed ? (
              // The card above already says what's wrong; don't repeat it.
              <Notice action={<Button size="sm" onClick={load}>Try again</Button>}>Fix {provider.name} above to see its models.</Notice>
            ) : (
              <Notice tone="danger" action={<Button size="sm" onClick={load}>Try again</Button>}>
                {error}
              </Notice>
            )}
            {provider.kind === 'custom' ? <p className="mt-3 text-[12.5px] text-muted">You can still type a model name in the search box and use it.</p> : null}
            {canUseTyped ? <TypedRow name={typed} onPick={() => pick({ id: typed, name: typed, contextLength: null, promptPrice: null, completionPrice: null })} /> : null}
          </div>
        ) : models === null ? (
          <div className={cn('flex flex-col gap-2 p-3 transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')} aria-busy>
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            {shown.map((m) => {
              const selected = current?.providerId === provider.id && current.modelId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(m)}
                  className={cn(
                    'grid w-full grid-cols-[1fr_72px_150px] items-center gap-3 border-b border-line/60 px-4 py-2 text-left transition-colors duration-100 last:border-b-0 hover:bg-surface-2',
                    selected && 'bg-accent-soft hover:bg-accent-soft'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0">{selected ? <Check size={14} className="text-accent" /> : null}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-fg">{m.name}</span>
                      {m.name !== m.id ? <span className="block truncate font-mono text-[11px] text-faint">{m.id}</span> : null}
                    </span>
                  </span>
                  <span className="text-right text-[12.5px] tabular-nums text-muted">{formatContext(m.contextLength)}</span>
                  <span className="text-right text-[12.5px] tabular-nums text-muted">
                    {m.promptPrice != null && m.completionPrice != null
                      ? m.promptPrice === 0 && m.completionPrice === 0
                        ? 'Free'
                        : `${pricePerMillion(m.promptPrice)} in · ${pricePerMillion(m.completionPrice)} out`
                      : '—'}
                  </span>
                </button>
              )
            })}
            {!shown.length ? (
              canUseTyped ? (
                <>
                  <TypedRow name={typed} onPick={() => pick({ id: typed, name: typed, contextLength: null, promptPrice: null, completionPrice: null })} />
                  <p className="px-4 py-3 text-[12.5px] text-faint">
                    {models.length ? `${provider.name} doesn't list a model called that, but you can still use it if you know the name is right.` : `${provider.name} didn't list any models, so type the exact name it expects.`}
                  </p>
                </>
              ) : (
                <p className="px-4 py-10 text-center text-[13px] text-muted">
                  {models.length ? `No models match “${typed}”.` : `${provider.name} didn't list any models. Type a model name in the search box to use it.`}
                </p>
              )
            ) : null}
          </>
        )}
      </div>
      {models && filtered.length > MAX_ROWS ? (
        <div className="border-t border-line px-4 py-2 text-[12px] text-faint">
          Showing {MAX_ROWS} of {filtered.length.toLocaleString()}. Keep typing to narrow it down.
        </div>
      ) : null}
    </Card>
  )
}

function TypedRow({ name, onPick }: { name: string; onPick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-2 border-b border-line/60 px-4 py-2.5 text-left text-[13.5px] text-accent transition-colors duration-100 hover:bg-surface-2"
    >
      <Plus size={14} className="shrink-0" />
      <span className="min-w-0 truncate">
        Use <span className="font-mono text-[12.5px]">{name}</span> as the model name
      </span>
    </button>
  )
}

// ---------- Thinking ----------

const THINKING_OPTIONS = (Object.keys(THINKING_LABELS) as ThinkingLevel[]).map((k) => ({ value: k, label: THINKING_LABELS[k] }))

const THINKING_HINTS: Record<ThinkingLevel, string> = {
  auto: 'The model thinks as much as it usually would.',
  off: 'Answers straight away: fastest and cheapest. A model that always thinks is asked to think as little as it can.',
  low: 'Thinks a little before it answers.',
  medium: 'Thinks for a while before it answers: slower, and costs more.',
  high: 'Thinks the most before it answers: slowest, and costs the most.'
}

const THINKING_NAMES: Record<ThinkingJob, string> = {
  writer: 'Writer model thinking',
  memory: 'Memory model thinking',
  builder: 'Character builder model thinking',
  world: 'World builder model thinking',
  chat: 'Chat and brainstorm model thinking',
  check: 'Consistency check model thinking',
  recipe: 'Recipe maker thinking',
  speech: 'Read aloud model thinking',
  sample: 'Thinking for sample passages',
  polish: 'Thinking for the polish pass',
  sounds: 'Sound effects thinking'
}

/** Sound effects' own Thinking (marking the sounds uses the Read aloud model), shown while they are on. */
function SoundsThinking(): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech?.soundEffects)
  if (!on) return null
  return <ThinkingChoice job="sounds" title="Thinking for sound effects" about="Choosing sounds doesn't need the model to think: Off is quickest." />
}


/**
 * How much a job's model thinks before it answers. It belongs to the job, so it stays the same whichever model
 * does the job. `hints: false` leaves out the line under the choice (for the writer model's other jobs, shown
 * just below the writer's own choice, which has it).
 */
function ThinkingChoice({
  job,
  about,
  title = 'Thinking',
  hints = true
}: {
  job: ThinkingJob
  about: string
  title?: string
  hints?: boolean
}): React.JSX.Element {
  const level = useApp((s) => s.settings?.thinking?.[job] ?? 'off')
  const update = useApp((s) => s.updateSettings)
  const choose = (l: ThinkingLevel): void => void update({ thinking: { [job]: l } }).catch((e: Error) => toast(e.message, { tone: 'danger' }))
  return (
    <div className="mt-5">
      <h3 className="text-[13.5px] font-medium text-fg">{title}</h3>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{about}</p>
      {/* The four levels share one width and "Model decides" takes the room its name needs, so the row fits the narrowest window. */}
      <Segmented
        label={THINKING_NAMES[job]}
        value={level}
        onChange={choose}
        options={THINKING_OPTIONS}
        className="mt-2.5 *:min-w-[72px] *:flex-none *:px-2.5"
      />
      {/* Every hint sits in the same cell, so the space under the choice is the longest hint's and never jumps. */}
      {hints ? (
        <div className="mt-2 grid text-[12.5px] text-faint">
          {THINKING_OPTIONS.map((o) => (
            <p key={o.value} className={cn('col-start-1 row-start-1', o.value !== level && 'invisible')}>
              {THINKING_HINTS[o.value]}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ---------- Default creativity ----------

function DefaultCreativity(): React.JSX.Element {
  const creativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const update = useApp((s) => s.updateSettings)
  return (
    <SettingsSection
      title="Default creativity"
      description="How freely the writer model plays with words and ideas. You can change it for any draft from the Generate options."
    >
      <Segmented label="Default creativity" value={creativity} onChange={(c) => void update({ creativity: c })} options={CREATIVITY_OPTIONS} className="w-[360px]" />
      <p className="mt-2 text-[12.5px] text-faint">{CREATIVITY_HINTS[creativity]}</p>
    </SettingsSection>
  )
}
