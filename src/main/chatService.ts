import type { MessageRow, ModelConfigRow } from './database'
import { loadApiKey } from './modelConfig'

export type ChatStreamHandlers = { onDelta: (delta: string) => void; onDone: () => void; onError: (message: string) => void }

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

export async function streamModelReply(config: Omit<ModelConfigRow, 'updated_at'>, messages: MessageRow[], controller: AbortController, handlers: ChatStreamHandlers) {
  const apiKey = loadApiKey(config.provider)
  if (!apiKey) throw new Error(`请先配置 ${config.provider} API Key`)
  const model = config.text_model || config.default_model
  if (!model) throw new Error(`请先配置 ${config.provider} 文本模型`)

  const request = makeRequest(config, apiKey, model, messages, controller.signal)
  let response = await fetchWithRetry(request.url, request.init, config.retry_count, controller.signal)
  if (!response.ok && response.status === 400 && config.api_protocol === 'chat_completions') {
    await response.body?.cancel()
    const compatibilityRequest = makeRequest(config, apiKey, model, messages, controller.signal, true)
    response = await fetchWithRetry(compatibilityRequest.url, compatibilityRequest.init, config.retry_count, controller.signal)
  }
  if (!response.ok) throw new Error(await readApiError(response))
  if (!response.body) throw new Error('模型服务未返回可读取的数据流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) parseSseEvent(event, config.api_protocol, handlers)
    }
    if (buffer.trim()) parseSseEvent(buffer, config.api_protocol, handlers)
    handlers.onDone()
  } finally { reader.releaseLock() }
}

function makeRequest(config: Omit<ModelConfigRow, 'updated_at'>, apiKey: string, model: string, messages: MessageRow[], signal: AbortSignal, compatibilityMode = false) {
  const common = { method: 'POST', signal, headers: { 'content-type': 'application/json' } as Record<string, string> }
  const input = messages.filter((item) => item.status !== 'failed' && item.content.trim()).map((item) => ({ role: item.role, content: item.content }))
  if (config.api_protocol === 'responses') {
    common.headers.Authorization = `Bearer ${apiKey}`
    return { url: endpoint(config.base_url, 'responses'), init: { ...common, body: JSON.stringify({ model, input, stream: true, store: false, temperature: config.temperature, max_output_tokens: config.max_tokens }) } }
  }
  if (config.api_protocol === 'claude_messages') {
    common.headers['x-api-key'] = apiKey
    common.headers['anthropic-version'] = '2023-06-01'
    return { url: endpoint(config.base_url, 'messages'), init: { ...common, body: JSON.stringify({ model, messages: input, stream: true, temperature: config.temperature, max_tokens: config.max_tokens }) } }
  }
  common.headers.Authorization = `Bearer ${apiKey}`
  if (config.provider === '小米 MiMo' || /xiaomimimo\.com/i.test(config.base_url)) common.headers['api-key'] = apiKey
  const body = compatibilityMode
    ? { model, messages: input, stream: true }
    : { model, messages: input, stream: true, temperature: config.temperature, max_tokens: config.max_tokens }
  return { url: endpoint(config.base_url, 'chat/completions'), init: { ...common, body: JSON.stringify(body) } }
}

async function fetchWithRetry(url: string, init: RequestInit, retries: number, signal: AbortSignal) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init)
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === retries) return response
      await response.body?.cancel()
      await delay(500 * 2 ** attempt, signal)
    } catch (error) {
      lastError = error
      if (signal.aborted || attempt === retries) throw error
      await delay(500 * 2 ** attempt, signal)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型服务连接失败')
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

function parseSseEvent(raw: string, protocol: ModelConfigRow['api_protocol'], handlers: ChatStreamHandlers) {
  const payload = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
  if (!payload || payload === '[DONE]') return
  let event: any
  try { event = JSON.parse(payload) } catch { return }
  if (protocol === 'responses') {
    if (event.type === 'response.output_text.delta' && event.delta) handlers.onDelta(event.delta)
    if (event.type === 'error') handlers.onError(event.message || event.error?.message || '模型生成失败')
    if (event.type === 'response.failed') handlers.onError(event.response?.error?.message || '模型生成失败')
    return
  }
  if (protocol === 'claude_messages') {
    if (event.type === 'content_block_delta' && event.delta?.text) handlers.onDelta(event.delta.text)
    if (event.type === 'error') handlers.onError(event.error?.message || 'Claude 生成失败')
    return
  }
  const delta = event.choices?.[0]?.delta?.content
  if (delta) handlers.onDelta(delta)
  if (event.error) handlers.onError(event.error.message || '模型生成失败')
}

async function readApiError(response: Response) {
  const raw = await response.text()
  let message = raw
  try { const body = JSON.parse(raw); message = body.error?.message || body.message || raw } catch {}
  if (response.status === 401) return 'API Key 无效或没有权限'
  if (response.status === 429) return '请求过于频繁或账户额度不足'
  return `${response.status} ${String(message).slice(0, 240)}`
}
