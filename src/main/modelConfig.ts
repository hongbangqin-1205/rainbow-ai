import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { getModelConfig, listModelConfigs, saveModelConfig, type ModelConfigRow } from './database'

export type ModelConfigInput = Omit<ModelConfigRow, 'updated_at'>

const defaults: Record<string, ModelConfigInput> = {
  OpenAI: { provider: 'OpenAI', base_url: 'https://api.openai.com/v1', api_protocol: 'responses', text_model: 'gpt-4.1-mini', image_model: 'gpt-image-1', video_model: '', voice_model: 'gpt-4o-mini-tts', asr_model: 'gpt-4o-mini-transcribe', default_model: 'gpt-4.1-mini', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 },
  DeepSeek: { provider: 'DeepSeek', base_url: 'https://api.deepseek.com', api_protocol: 'chat_completions', text_model: 'deepseek-chat', image_model: '', video_model: '', voice_model: '', asr_model: '', default_model: 'deepseek-chat', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 },
  Claude: { provider: 'Claude', base_url: 'https://api.anthropic.com/v1', api_protocol: 'claude_messages', text_model: 'claude-sonnet-4-5', image_model: '', video_model: '', voice_model: '', asr_model: '', default_model: 'claude-sonnet-4-5', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 },
  通义千问: { provider: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api_protocol: 'chat_completions', text_model: 'qwen-plus', image_model: 'wanx-v1', video_model: '', voice_model: '', asr_model: '', default_model: 'qwen-plus', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 },
  豆包: { provider: '豆包', base_url: 'https://ark.cn-beijing.volces.com/api/v3', api_protocol: 'chat_completions', text_model: '', image_model: '', video_model: '', voice_model: '', asr_model: '', default_model: '', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 },
  '小米 MiMo': { provider: '小米 MiMo', base_url: 'https://api.xiaomimimo.com/v1', api_protocol: 'chat_completions', text_model: 'mimo-v2.6-flash', image_model: '', video_model: '', voice_model: 'mimo-v2.5-tts', asr_model: 'mimo-v2.5-asr', default_model: 'mimo-v2.6-flash', temperature: 0.7, max_tokens: 4096, timeout_seconds: 120, retry_count: 2 },
  极客智坊: { provider: '极客智坊', base_url: 'https://geekai.co/api/v1', api_protocol: 'chat_completions', text_model: '', image_model: '', video_model: 'doubao-seedance-2.0', voice_model: 'gpt-4o-mini-tts', asr_model: 'gpt-4o-mini-transcribe', default_model: '', temperature: 0.7, max_tokens: 4096, timeout_seconds: 120, retry_count: 2 },
  DMXAPI: { provider: 'DMXAPI', base_url: 'https://www.dmxapi.cn/v1', api_protocol: 'chat_completions', text_model: 'gpt-5.6-luna', image_model: '', video_model: 'doubao-seedance-2-0-260128', voice_model: 'mimo-v2.5-tts', asr_model: '', default_model: 'gpt-5.6-luna', temperature: 0.7, max_tokens: 4096, timeout_seconds: 120, retry_count: 2 },
  '自定义兼容 API': { provider: '自定义兼容 API', base_url: 'https://example.com/v1', api_protocol: 'chat_completions', text_model: '', image_model: '', video_model: '', voice_model: '', asr_model: '', default_model: '', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 }
}

function secretsPath() { return join(app.getPath('userData'), 'secrets', 'model-keys.json') }
function readSecrets(): Record<string, string> {
  const file = secretsPath()
  if (!existsSync(file)) return {}
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> } catch { return {} }
}
function writeSecrets(value: Record<string, string>) {
  const file = secretsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
}
function saveApiKey(provider: string, apiKey: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，API Key 未保存')
  const secrets = readSecrets()
  secrets[provider] = safeStorage.encryptString(apiKey).toString('base64')
  writeSecrets(secrets)
}
export function loadApiKey(provider: string) {
  const encrypted = readSecrets()[provider]
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { return '' }
}

export function listTextProviderConfigs() {
  const stored = listModelConfigs()
  const names = Array.from(new Set([...stored.map((item) => item.provider), ...Object.keys(defaults)]))
  return names.map((provider) => {
    const config = getModelConfig(provider) ?? defaults[provider]
    return { provider, model: config?.text_model || config?.default_model || '', configured: Boolean(loadApiKey(provider)), base_url: config?.base_url || '' }
  })
}

export function resolveTextConfig(provider?: string) {
  if (provider) {
    const config = getModelConfig(provider) ?? defaults[provider]
    if (!config) throw new Error(`没有找到 ${provider} 的模型配置`)
    if (!loadApiKey(provider)) throw new Error(`请先在“API 与模型”中配置 ${provider} API Key`)
    if (!config.text_model && !config.default_model) throw new Error(`请先为 ${provider} 设置文本模型`)
    return { ...config, text_model: config.text_model || config.default_model }
  }
  for (const config of listModelConfigs()) if (loadApiKey(config.provider) && (config.text_model || config.default_model)) return { ...config, text_model: config.text_model || config.default_model }
  throw new Error('请先在“API 与模型”中配置至少一个文本模型和 API Key')
}

export function resolveVoiceConfig(provider?: string) {
  const candidates = provider ? [getModelConfig(provider) ?? defaults[provider]] : listModelConfigs()
  for (const config of candidates) if (config && loadApiKey(config.provider) && config.voice_model) return config
  throw new Error('请先在“API 与模型”中配置支持语音的服务商、API Key 和语音模型')
}

export function listVoiceProviderConfigs() {
  const stored = listModelConfigs()
  const names = Array.from(new Set([...stored.map((item) => item.provider), ...Object.keys(defaults)]))
  return names.map((provider) => {
    const config = getModelConfig(provider) ?? defaults[provider]
    return { provider, model: config?.voice_model || '', configured: Boolean(loadApiKey(provider)), base_url: config?.base_url || '' }
  })
}

export function listAsrProviderConfigs() {
  const stored = listModelConfigs()
  const names = Array.from(new Set([...stored.map((item) => item.provider), ...Object.keys(defaults)]))
  return names.map((provider) => {
    const config = getModelConfig(provider) ?? defaults[provider]
    return { provider, model: config?.asr_model || '', configured: Boolean(loadApiKey(provider)), base_url: config?.base_url || '' }
  })
}

export function resolveAsrConfig(provider: string) {
  const config = getModelConfig(provider) ?? defaults[provider]
  if (!config) throw new Error(`没有找到 ${provider} 的模型配置`)
  if (!loadApiKey(provider)) throw new Error(`请先在“API 与模型”中配置 ${provider} API Key`)
  if (!config.asr_model) throw new Error(`请先为 ${provider} 设置 ASR 转写模型`)
  return config
}

export function listImageProviderConfigs() {
  const stored = listModelConfigs()
  const names = Array.from(new Set([...stored.map((item) => item.provider), ...Object.keys(defaults)]))
  return names.map((provider) => {
    const config = getModelConfig(provider) ?? defaults[provider]
    return { provider, model: config?.image_model || '', configured: Boolean(loadApiKey(provider)), base_url: config?.base_url || '' }
  })
}

export function listVideoProviderConfigs() {
  const stored = listModelConfigs()
  const names = Array.from(new Set([...stored.map((item) => item.provider), 'DMXAPI', '极客智坊']))
  return names.map((provider) => {
    const config = getModelConfig(provider) ?? defaults[provider]
    const defaultsForProvider = provider === '极客智坊' ? ['doubao-seedance-2.0', 'kling-video-v3'] : provider === 'DMXAPI' ? ['doubao-seedance-2-0-260128'] : []
    const models = Array.from(new Set([...(config?.video_model ? [config.video_model] : []), ...defaultsForProvider]))
    return { provider, models, model: models[0] || '', configured: Boolean(loadApiKey(provider)), base_url: config?.base_url || '' }
  }).filter((item) => item.models.length > 0)
}

export function resolveImageConfig(provider: string) {
  const config = getModelConfig(provider) ?? defaults[provider]
  if (!config) throw new Error(`没有找到 ${provider} 的模型配置`)
  if (!loadApiKey(provider)) throw new Error(`请先在“API 与模型”中配置 ${provider} API Key`)
  if (!config.image_model) throw new Error(`请先为 ${provider} 设置图片模型`)
  return config
}

export function loadModelConfig(provider: string) {
  const config = getModelConfig(provider) ?? defaults[provider] ?? { ...defaults.OpenAI, provider }
  return { ...config, has_api_key: Boolean(loadApiKey(provider)) }
}

export function persistModelConfig(config: ModelConfigInput, apiKey?: string) {
  const saved = saveModelConfig(normalizeConfig(config))
  if (apiKey?.trim()) saveApiKey(config.provider, apiKey.trim())
  return { ...saved, has_api_key: Boolean(loadApiKey(config.provider)) }
}

function normalizeConfig(config: ModelConfigInput): ModelConfigInput {
  const baseUrl = config.base_url.trim().replace(/\/$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('API 地址必须以 http:// 或 https:// 开头')
  return {
    ...config,
    base_url: baseUrl,
    api_protocol: ['responses', 'chat_completions', 'claude_messages'].includes(config.api_protocol) ? config.api_protocol : 'chat_completions',
    temperature: Math.min(2, Math.max(0, Number(config.temperature) || 0)),
    max_tokens: Math.max(1, Math.round(Number(config.max_tokens) || 4096)),
    timeout_seconds: Math.min(300, Math.max(5, Math.round(Number(config.timeout_seconds) || 60))),
    retry_count: Math.min(5, Math.max(0, Math.round(Number(config.retry_count) || 0)))
  }
}

export async function testModelConnection(config: ModelConfigInput, apiKey?: string) {
  const normalized = normalizeConfig(config)
  const key = apiKey?.trim() || loadApiKey(normalized.provider)
  if (!key) return { ok: false, message: '请先输入或保存 API Key', models: [] as string[] }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), normalized.timeout_seconds * 1000)
  const headers: Record<string, string> = normalized.api_protocol === 'claude_messages'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${key}` }
  if (normalized.provider === '小米 MiMo' || /xiaomimimo\.com/i.test(normalized.base_url)) headers['api-key'] = key
  try {
    const response = await fetch(`${normalized.base_url}/models`, { headers, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      let detail = text
      try { const body = JSON.parse(text); detail = body.error?.message || body.message || text } catch {}
      return { ok: false, message: `${response.status} ${String(detail).slice(0, 180)}`, models: [] as string[] }
    }
    let models: string[] = []
    try { const body = JSON.parse(text); models = [...new Set<string>((body.data ?? []).map((item: { id?: string }) => item.id).filter(Boolean))].sort((a, b) => a.localeCompare(b)) } catch {}
    return { ok: true, message: `连接成功${models.length ? `，发现 ${models.length} 个模型` : ''}`, models }
  } catch (error) {
    const message = error instanceof Error ? error.message : '网络连接失败'
    return { ok: false, message: message === 'This operation was aborted' ? '连接超时' : message, models: [] as string[] }
  } finally { clearTimeout(timer) }
}
