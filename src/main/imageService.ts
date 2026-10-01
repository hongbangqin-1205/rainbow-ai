import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { ModelConfigRow } from './database'
import { saveImageWork } from './database'
import { loadApiKey } from './modelConfig'
import { getStorageRoot } from './storageService'

export type ImageGenerationInput = { prompt: string; style: string; size: string; quality: string; count: number; referencePath?: string }
export type ImageGenerationResult = { id: number; prompt: string; provider: string; model: string; size: string; quality: string; file_path: string; mime_type: string; revised_prompt: string | null; created_at: string; data_url: string }

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

export async function generateImages(config: Omit<ModelConfigRow, 'updated_at'>, input: ImageGenerationInput, controller: AbortController): Promise<ImageGenerationResult[]> {
  const apiKey = loadApiKey(config.provider)
  if (!apiKey) throw new Error(`请先配置 ${config.provider} API Key`)
  if (!config.image_model) throw new Error(`请先配置 ${config.provider} 图片模型`)
  const fullPrompt = input.style && input.style !== '自动' ? `${input.prompt}\n\n视觉风格：${input.style}` : input.prompt
  const response = input.referencePath
    ? await requestEdit(config, apiKey, { ...input, prompt: fullPrompt }, controller.signal)
    : await requestGeneration(config, apiKey, { ...input, prompt: fullPrompt }, controller.signal)
  if (!response.ok) throw new Error(await readApiError(response))
  const body = await response.json() as any
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.images) ? body.images : Array.isArray(body.output) ? body.output : []
  if (!items.length) throw new Error(body.error?.message || '图片服务没有返回图片数据')
  const results: ImageGenerationResult[] = []
  for (const item of items.slice(0, input.count)) {
    const decoded = await decodeImage(item, controller.signal)
    const directory = join(getStorageRoot(app), 'works', 'images')
    mkdirSync(directory, { recursive: true })
    const extension = extensionForMime(decoded.mimeType)
    const filePath = join(directory, `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`)
    writeFileSync(filePath, decoded.buffer)
    const row = saveImageWork({ prompt: input.prompt, provider: config.provider, model: config.image_model, size: input.size, quality: input.quality, file_path: filePath, mime_type: decoded.mimeType, revised_prompt: item.revised_prompt ?? body.revised_prompt ?? null })
    results.push({ ...row, data_url: `data:${decoded.mimeType};base64,${decoded.buffer.toString('base64')}` })
  }
  return results
}

function requestGeneration(config: Omit<ModelConfigRow, 'updated_at'>, apiKey: string, input: ImageGenerationInput, signal: AbortSignal) {
  const body: Record<string, unknown> = { model: config.image_model, prompt: input.prompt, quality: input.quality, n: input.count }
  if (input.size !== 'auto') body.size = input.size
  return fetch(endpoint(config.base_url, 'images/generations'), {
    method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function requestEdit(config: Omit<ModelConfigRow, 'updated_at'>, apiKey: string, input: ImageGenerationInput, signal: AbortSignal) {
  const file = readFileSync(input.referencePath!)
  const form = new FormData()
  form.append('model', config.image_model)
  form.append('prompt', input.prompt)
  if (input.size !== 'auto') form.append('size', input.size)
  form.append('quality', input.quality)
  form.append('n', String(input.count))
  form.append('image', new Blob([new Uint8Array(file)], { type: mimeForPath(input.referencePath!) }), `reference${extname(input.referencePath!) || '.png'}`)
  return fetch(endpoint(config.base_url, 'images/edits'), { method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey}` }, body: form })
}

async function decodeImage(item: any, signal: AbortSignal) {
  const encoded = item.b64_json || item.b64 || item.base64 || (typeof item === 'string' && !item.startsWith('http') ? item : '')
  if (encoded) {
    const match = String(encoded).match(/^data:([^;]+);base64,(.+)$/s)
    return { buffer: Buffer.from(match ? match[2] : encoded, 'base64'), mimeType: match?.[1] || 'image/png' }
  }
  const remoteUrl = item.url || item.image_url || (typeof item === 'string' ? item : '')
  if (!/^https?:\/\//i.test(remoteUrl)) throw new Error('图片服务返回了无法识别的图片格式')
  const response = await fetch(remoteUrl, { signal })
  if (!response.ok) throw new Error(`下载生成图片失败：${response.status}`)
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType }
}

async function readApiError(response: Response) {
  const raw = await response.text()
  let message = raw
  try { const body = JSON.parse(raw); message = body.error?.message || body.message || raw } catch {}
  if (response.status === 401) return 'API Key 无效或没有图片模型权限'
  if (response.status === 429) return '请求过于频繁或账户额度不足'
  return `${response.status} ${String(message).slice(0, 260)}`
}

function mimeForPath(path: string) { const extension = extname(path).toLowerCase(); return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png' }
function extensionForMime(mime: string) { return mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png' }
