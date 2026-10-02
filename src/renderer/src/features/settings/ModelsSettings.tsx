// Settings > Models: connect OpenRouter or another provider, test it, and pick
// the writer model. Keys are sent to the main process once and never come back.
import { Check, KeyRound, PenLine, Plus, Search, Server } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Creativity, ID, ModelChoice, ModelInfo, ProviderConfig } from '@shared/types'
import { CREATIVITY_PRESETS, OPENROUTER_BASE_URL } from '@shared/defaults'
import { Badge, Button, Card, Field, Input, Notice, Select, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { CREATIVITY_HINTS, filterModels, formatContext, pricePerMillion } from '@/features/generate/format'
import { Segmented, Skeleton, useDelayed } from '@/features/generate/parts'

type TestResult = { state: 'testing' } | { state: 'done'; ok: boolean; message: string }

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

export function ModelsSettings(): React.JSX.Element {
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
  const clearResult = (key: string): void =>
    setResults((r) => {
      const n = { ...r }
      delete n[key]
      return n
    })

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
      <WriterModel providers={providers} result={results.writer} onTest={(pid, mid) => void test('writer', pid, mid)} onClearResult={() => clearResult('writer')} />
      <DefaultCreativity />
      <p className="text-[12.5px] text-faint">Separate models for memory upkeep and for chat are coming in a later version.</p>
    </div>
  )
}

// ---------- Pieces ----------

function SectionHead({ title, children, badge }: { title: string; children?: ReactNode; badge?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {badge}
      </div>
      {children ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{children}</p> : null}
    </div>
  )
}

function ResultNotice({ result }: { result: TestResult | undefined }): React.JSX.Element | null {
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

function IconTile({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'neutral' }): React.JSX.Element {
  return (
    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>
      {children}
    </div>
  )
}

// ---------- OpenRouter ----------

function OpenRouterCard({
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
            ) : result?.state === 'done' && !result.ok ? (
              <Badge tone="danger">Not working</Badge>
            ) : (
              <Badge tone="success">Connected</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            One key for hundreds of models, each with its price shown up front. Make a key at{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">
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
        <div className="mt-4 flex flex-wrap items-center gap-2 pl-12">
          <span className="mr-auto text-[12.5px] text-muted">Your key is saved on this computer, encrypted.</span>
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

function OtherProviders({
  providers,
  results,
  onTest,
  onClearResult,
  onChanged
}: {
  providers: ProviderConfig[]
  results: Record<string, TestResult>
  onTest: (id: ID) => void
  onClearResult: (id: ID) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
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
    <section>
      <SectionHead title="Other providers">
        Any service that works like OpenAI's: OpenAI, DeepSeek, Mistral, Groq and others, or models running on this computer through LM Studio or Ollama.
      </SectionHead>
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
              <div className="flex items-center gap-3">
                <IconTile tone="neutral">
                  <Server size={16} />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{p.name}</span>
                    <Badge className="shrink-0">
                      {p.hasKey ? 'Key saved' : 'No key'}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-faint">{p.baseUrl}</div>
                </div>
                <div className="flex shrink-0 gap-1">
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
    </section>
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

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
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
                  setName(p.name)
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
          label="API key (optional)"
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
              'The saved key will be removed when you save.'
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

// ---------- Writer model ----------

function WriterModel({
  providers,
  result,
  onTest,
  onClearResult
}: {
  providers: ProviderConfig[]
  result: TestResult | undefined
  onTest: (providerId: ID, modelId: string) => void
  onClearResult: () => void
}): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const update = useApp((s) => s.updateSettings)
  const [picking, setPicking] = useState(false)
  const writerProvider = writer ? providers.find((p) => p.id === writer.providerId) ?? null : null

  const choose = async (choice: ModelChoice): Promise<void> => {
    try {
      await update({ models: { writer: choice } })
      setPicking(false)
      onClearResult()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <section>
      <SectionHead title="Writer model">The model that drafts your scenes. Pick one with the best prose you can afford; you can switch any time.</SectionHead>
      {!providers.length ? (
        <Notice>Connect OpenRouter or add a provider above, then pick the model that writes your scenes here.</Notice>
      ) : writer && writerProvider && !picking ? (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <IconTile>
              <PenLine size={16} />
            </IconTile>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-fg" title={writer.modelId}>
                {writer.label || writer.modelId}
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">
                {writerProvider.name}
                {writer.contextLength ? ` · reads up to ${formatContext(writer.contextLength)} tokens` : ''}
                {writer.promptPrice != null && writer.completionPrice != null
                  ? ` · ${pricePerMillion(writer.promptPrice)} in, ${pricePerMillion(writer.completionPrice)} out per million tokens`
                  : ''}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" onClick={() => onTest(writer.providerId, writer.modelId)} loading={result?.state === 'testing'}>
                Test this model
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                Change
              </Button>
            </div>
          </div>
          {writerProvider.kind === 'custom' || writer.contextLength == null ? (
            <ContextLengthField key={`${writer.providerId}/${writer.modelId}`} writer={writer} />
          ) : null}
          {result ? (
            <div className="mt-3 pl-12">
              <ResultNotice result={result} />
            </div>
          ) : null}
        </Card>
      ) : (
        <ModelPicker
          providers={providers}
          current={writer}
          autoFocus={picking}
          onChoose={(c) => void choose(c)}
          onCancel={writer && writerProvider ? () => setPicking(false) : undefined}
        />
      )}
    </section>
  )
}

function ContextLengthField({ writer }: { writer: ModelChoice }): React.JSX.Element {
  const update = useApp((s) => s.updateSettings)
  const [text, setText] = useState(writer.contextLength != null ? String(writer.contextLength) : '')
  const [error, setError] = useState<string | null>(null)
  const commit = (): void => {
    const digits = text.replace(/[^\d]/g, '')
    if (!digits) {
      // Cleared: back to "not known", which AI Write treats as 16,000.
      setError(null)
      if (writer.contextLength != null) void update({ models: { writer: { ...writer, contextLength: null } } }).catch(() => undefined)
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
    if (value !== writer.contextLength) void update({ models: { writer: { ...writer, contextLength: value } } }).catch(() => undefined)
  }
  return (
    <div className="mt-4 border-t border-line pt-4 pl-12">
      <Field
        label="How much can this model read at once?"
        error={error}
        hint={
          writer.contextLength == null
            ? "This provider doesn't say. Check the model's page; if you're not sure, leave it and AI Write will assume 16,000 tokens."
            : "AI Write fits each briefing to this. Change it if the model's page says it can read more or less."
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

function ModelPicker({
  providers,
  current,
  autoFocus,
  onChoose,
  onCancel
}: {
  providers: ProviderConfig[]
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

  const pick = (m: ModelInfo): void =>
    onChoose({
      providerId: provider.id,
      modelId: m.id,
      label: m.name,
      contextLength: m.contextLength,
      promptPrice: m.promptPrice,
      completionPrice: m.completionPrice,
      maxOutput: m.maxOutput ?? null
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
            <Notice tone="danger" action={<Button size="sm" onClick={load}>Try again</Button>}>
              {error}
            </Notice>
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

// ---------- Default creativity ----------

function DefaultCreativity(): React.JSX.Element {
  const creativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const update = useApp((s) => s.updateSettings)
  return (
    <section>
      <SectionHead title="Default creativity">How freely the writer model plays with words and ideas. You can change it for any draft from the Generate options.</SectionHead>
      <Segmented label="Default creativity" value={creativity} onChange={(c) => void update({ creativity: c })} options={CREATIVITY_OPTIONS} className="w-[360px]" />
      <p className="mt-2 text-[12.5px] text-faint">{CREATIVITY_HINTS[creativity]}</p>
    </section>
  )
}
