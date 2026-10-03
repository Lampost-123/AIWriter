import { describe, expect, it } from 'vitest'
import {
  describeFailure,
  extractProviderMessage,
  isLocalUrl,
  looksLikeReplyLimitRejected,
  looksLikeSamplingRejected,
  looksLikeTokenParamRejected,
  networkCode,
  retryReason,
  type ProviderRef
} from './errors'

const openrouter: ProviderRef = { name: 'OpenRouter', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', hasKey: true }
const lmstudio: ProviderRef = { name: 'LM Studio', kind: 'custom', baseUrl: 'http://localhost:1234/v1', hasKey: false }
const deepseek: ProviderRef = { name: 'DeepSeek', kind: 'custom', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }

const http = (status: number, message = '') => ({ type: 'http' as const, status, message })

describe('describeFailure', () => {
  it('explains key problems with where to fix them', () => {
    expect(describeFailure(http(401), openrouter)).toBe("OpenRouter didn't accept your API key. Check it in Settings › Models.")
    expect(describeFailure(http(403, 'Forbidden'), deepseek)).toBe("DeepSeek didn't accept your API key. Check it in Settings › Models.")
    expect(describeFailure(http(401), { ...deepseek, hasKey: false })).toBe('DeepSeek needs an API key. Add one in Settings › Models.')
  })

  it('explains running out of credit', () => {
    expect(describeFailure(http(402), openrouter)).toBe('Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.')
    expect(describeFailure(http(402), deepseek)).toContain('DeepSeek says your account is out of credit')
  })

  it('tells an unknown model apart from a wrong address', () => {
    expect(describeFailure(http(404, 'No endpoints found for model x/y'), openrouter, { during: 'draft', modelId: 'x/y' })).toBe(
      "OpenRouter doesn't have a model called “x/y”. Pick another writer model in Settings › Models."
    )
    expect(describeFailure(http(404, 'Not Found'), deepseek)).toContain('Check the base URL in Settings › Models')
    expect(describeFailure(http(404, 'Not Found'), deepseek, { during: 'models' })).toContain('Click Edit and check the base URL')
  })

  it('says plainly when a model can’t use the editor chat’s tools', () => {
    const noTools = 'No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing'
    expect(describeFailure(http(404, noTools), openrouter, { during: 'draft', modelId: 'x/y' })).toContain('This model can’t use the tools the editor chat needs')
    expect(describeFailure(http(400, '"tool_choice" is not supported'), deepseek)).toContain('Chat and brainstorm model in Settings › Models')
    expect(describeFailure(http(400, 'context length exceeded'), deepseek)).not.toContain('tools')
  })

  it('points to the button on the page when testing on Settings › Models', () => {
    expect(describeFailure(http(401), openrouter, { during: 'test' })).toBe(
      "OpenRouter didn't accept this key. Copy it again from openrouter.ai/keys and click Replace key."
    )
    expect(describeFailure(http(401), deepseek, { during: 'models' })).toBe("DeepSeek didn't accept this API key. Click Edit and paste it again.")
    expect(describeFailure(http(401), { ...deepseek, hasKey: false }, { during: 'test' })).toBe('DeepSeek needs an API key. Click Edit and paste it.')
    expect(describeFailure({ type: 'network', code: 'ENOTFOUND', message: '' }, deepseek, { during: 'test' })).toContain('click Edit and check the base URL')
    expect(describeFailure(http(404, 'model not found'), deepseek, { during: 'test', modelId: 'x' })).toBe(
      "DeepSeek doesn't have a model called “x”. Click Change and pick another writer model."
    )
    const onPage = [
      describeFailure(http(401), openrouter, { during: 'test' }),
      describeFailure(http(503), openrouter, { during: 'test' }),
      describeFailure(http(400, 'bad'), deepseek, { during: 'test', modelId: 'x' }),
      describeFailure(http(418), deepseek, { during: 'models' }),
      describeFailure({ type: 'bad-response', message: '' }, lmstudio, { during: 'models' }),
      describeFailure({ type: 'network', code: 'CERT_HAS_EXPIRED', message: '' }, deepseek, { during: 'test' })
    ].join(' ')
    expect(onPage).not.toContain('Settings')
  })

  it("explains a model that doesn't take a setting, without blaming the length", () => {
    const o3 = "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
    expect(looksLikeTokenParamRejected(400, o3)).toBe(true)
    expect(looksLikeReplyLimitRejected(400, o3)).toBe(false)
    expect(describeFailure(http(400, o3), deepseek)).toBe("This model doesn't accept one of the settings AI Write sent. Pick another writer model in Settings › Models.")
    const gpt5 = "Unsupported value: 'temperature' does not support 0.85 with this model. Only the default (1) value is supported."
    expect(looksLikeSamplingRejected(400, gpt5)).toBe(true)
    expect(looksLikeTokenParamRejected(400, gpt5)).toBe(false)
    expect(describeFailure(http(400, gpt5), deepseek)).toContain("doesn't accept one of the settings")
    expect(looksLikeSamplingRejected(400, '`temperature` and `top_p` cannot both be specified for this model.')).toBe(true)
    expect(looksLikeSamplingRejected(400, "This model's maximum context length is 8192 tokens.")).toBe(false)
  })

  it('explains a briefing that is too long for the model', () => {
    const msg = "This endpoint's maximum context length is 8192 tokens. However, you requested about 9000 tokens."
    expect(describeFailure(http(400, msg), openrouter)).toBe(
      'The briefing and the length you asked for are too much for this model together. Lower the length in the draft options, shorten the scene card, or pick a model that can read more in Settings › Models.'
    )
    expect(describeFailure(http(413), deepseek)).toContain('too much for this model together')
  })

  it('tells a reply that is too long apart from a briefing that is too long', () => {
    const limit = 'max_tokens: 5670 > 4096, which is the maximum allowed number of output tokens for this model'
    expect(describeFailure(http(400, limit), openrouter)).toBe(
      "This model can't write that much in one reply. Lower the length in the draft options, or pick another writer model in Settings › Models."
    )
    expect(describeFailure(http(400, 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]'), deepseek)).toContain("can't write that much")
    const ctx = "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (6000 in the messages, 3000 in the completion)."
    expect(describeFailure(http(400, ctx), deepseek)).toContain('too much for this model together')
  })

  it('knows when asking for a shorter reply could help', () => {
    expect(looksLikeReplyLimitRejected(400, 'max_tokens is too large: 5670. This model supports at most 4096 completion tokens')).toBe(true)
    expect(looksLikeReplyLimitRejected(400, "This endpoint's maximum context length is 3000 tokens.")).toBe(true)
    expect(looksLikeReplyLimitRejected(422, 'Unrecognized request argument supplied: stream_options')).toBe(false)
    expect(looksLikeReplyLimitRejected(401, 'max_tokens')).toBe(false)
    expect(looksLikeReplyLimitRejected(402, 'This request requires more credits, or fewer max_tokens. You requested up to 9000 tokens, but can only afford 3000.')).toBe(true)
    expect(looksLikeReplyLimitRejected(402, 'Insufficient credits')).toBe(false)
  })

  it('points to another model when the model refuses', () => {
    expect(describeFailure({ type: 'refused' }, openrouter)).toBe('This model refused the scene. Try another model in Settings › Models.')
    expect(describeFailure(http(403, 'Your input was flagged by moderation'), openrouter)).toBe(
      'This model refused the scene. Try another model in Settings › Models.'
    )
  })

  it('explains a local server that is not running', () => {
    const m = describeFailure({ type: 'network', code: 'ECONNREFUSED', message: 'fetch failed' }, lmstudio)
    expect(m).toContain("Couldn't reach LM Studio at http://localhost:1234/v1")
    expect(m).toContain('open and its server is started')
  })

  it('explains internet and address problems', () => {
    expect(describeFailure({ type: 'network', code: 'ENOTFOUND', message: '' }, deepseek)).toBe(
      "Couldn't find api.deepseek.com. Check your internet connection, and the base URL in Settings › Models."
    )
    expect(describeFailure({ type: 'network', code: null, message: '' }, deepseek)).toBe(
      "Couldn't connect to DeepSeek. Check your internet connection, then try again."
    )
  })

  it('explains timeouts, busy servers and outages', () => {
    expect(describeFailure({ type: 'timeout' }, openrouter)).toBe("OpenRouter didn't answer in time. Try again in a moment.")
    expect(describeFailure(http(429), deepseek)).toContain('Wait a minute')
    expect(describeFailure(http(503), openrouter)).toContain('OpenRouter is having trouble right now')
  })

  it('keeps the text when a connection drops partway', () => {
    expect(describeFailure({ type: 'dropped' }, openrouter)).toContain('The text that arrived is kept')
  })

  it('never uses words Adam does not use', () => {
    const all = [
      describeFailure(http(400, 'bad'), openrouter),
      describeFailure(http(500), openrouter),
      describeFailure({ type: 'empty' }, openrouter),
      describeFailure({ type: 'bad-response', message: '' }, lmstudio)
    ].join(' ')
    expect(all).not.toMatch(/generation|LLM|entity/i)
  })
})

describe('helpers', () => {
  it('reads error messages from common body shapes', () => {
    expect(extractProviderMessage('{"error":{"message":"Bad key","code":401}}')).toBe('Bad key')
    expect(extractProviderMessage('{"error":"Model not loaded"}')).toBe('Model not loaded')
    expect(extractProviderMessage('{"detail":"Not found"}')).toBe('Not found')
    expect(extractProviderMessage('<html><body><h1>502 Bad Gateway</h1></body></html>')).toBe('502 Bad Gateway')
    expect(extractProviderMessage('')).toBe('')
  })

  it('knows which addresses are on this computer or network', () => {
    expect(isLocalUrl('http://localhost:1234/v1')).toBe(true)
    expect(isLocalUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalUrl('http://192.168.1.20:8080/v1')).toBe(true)
    expect(isLocalUrl('http://[::1]:8080/v1')).toBe(true)
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
    expect(isLocalUrl('http://gpu-box:8080/v1')).toBe(true)
    expect(isLocalUrl('http://100.101.2.3:1234/v1')).toBe(true)
    expect(isLocalUrl('https://api.deepseek.com/v1')).toBe(false)
  })

  it('finds the error code inside a fetch failure', () => {
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    expect(networkCode(err)).toBe('ECONNREFUSED')
    expect(networkCode(new Error('x'))).toBeNull()
  })

  it('gives a short reason while retrying', () => {
    expect(retryReason({ status: 429 }, openrouter)).toBe('OpenRouter is busy')
    expect(retryReason({ network: true }, lmstudio)).toBe("Couldn't reach LM Studio")
  })
})
