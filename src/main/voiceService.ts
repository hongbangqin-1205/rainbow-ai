import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadApiKey, resolveVoiceConfig } from './modelConfig'
import { getStorageRoot } from './storageService'
import { getVoiceSample, saveAudioWork, type VoiceSampleRow } from './database'

export type NarrationInput = { text: string; voice: string; speed: number; emotion?: string; provider?: string; projectId?: number; title?: string; cloneSampleId?: number }

export async function generateNarration(input: NarrationInput, signal: AbortSignal) {
  const config = resolveVoiceConfig(input.provider); const apiKey = loadApiKey(config.provider); const model = config.voice_model
  const cloneSample = input.cloneSampleId ? getVoiceSample(input.cloneSampleId) : undefined
  if (input.cloneSampleId && !cloneSample) throw new Error('选择的克隆音色样本不存在，请重新选择')
  if (cloneSample && !cloneSample.authorized) throw new Error('该声音样本尚未确认授权，无法用于克隆')
  if (cloneSample && !/^mimo-.*-tts/i.test(model)) throw new Error('当前仅支持使用 MiMo TTS 服务生成克隆音色')
  if (/^mimo-.*-tts/i.test(model)) return generateMimoNarration(config.base_url, apiKey, cloneSample ? 'mimo-v2.5-tts-voiceclone' : model, input, signal, cloneSample)
  const url = `${config.base_url.replace(/\/$/, '')}/audio/speech`
  const instructions = input.emotion && input.emotion !== '自然' ? `请使用${input.emotion}的表达方式朗读，保持中文自然流畅。` : undefined
  const response = await fetch(url, { method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, voice: input.voice || 'alloy', input: input.text.slice(0, 12000), speed: Math.min(4, Math.max(.25, input.speed || 1)), response_format: 'mp3', ...(instructions ? { instructions } : {}) }) })
  if (!response.ok) { const raw = await response.text(); let detail = raw; try { const body = JSON.parse(raw); detail = body.error?.message || body.message || raw } catch {}; throw new Error(response.status === 401 ? '语音 API Key 无效或没有权限' : `${response.status} ${String(detail).slice(0, 200)}`) }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('语音服务返回了空音频')
  const stamp = Date.now(); const filePath = join(getStorageRoot(app), 'audio', `narration-${stamp}.mp3`); mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, buffer)
  const title = input.title?.trim() || `旁白-${new Date(stamp).toLocaleString('zh-CN', { hour12: false }).replace(/[\/:]/g, '-')}`
  const work = saveAudioWork({ title, prompt: input.text, provider: config.provider, model, voice: input.voice || 'alloy', speed: Math.min(4, Math.max(.25, input.speed || 1)), file_path: filePath, mime_type: 'audio/mpeg', video_project_id: input.projectId ?? null })
  return { id: work.id, title: work.title, filePath, dataUrl: `data:audio/mpeg;base64,${readFileSync(filePath).toString('base64')}`, provider: config.provider, model, voice: work.voice, speed: work.speed }
}

async function generateMimoNarration(baseUrl: string, apiKey: string, model: string, input: NarrationInput, signal: AbortSignal, cloneSample?: VoiceSampleRow) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const openAiVoices = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'])
  const requestedVoice = input.voice?.trim() || 'mimo_default'
  const voice = cloneSample ? voiceDataUri(cloneSample) : openAiVoices.has(requestedVoice.toLowerCase()) ? 'mimo_default' : requestedVoice
  const styleParts = [`请使用${input.emotion || '自然'}的表达方式朗读`]
  if (input.speed && Math.abs(input.speed - 1) >= .01) styleParts.push(`语速约为正常语速的 ${input.speed.toFixed(2)} 倍`)
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: `${styleParts.join('，')}，保持吐字清晰、语气自然。` },
        { role: 'assistant', content: input.text.slice(0, 12000) }
      ],
      audio: { format: 'wav', voice }
    })
  })
  if (!response.ok) {
    const message = await voiceApiError(response)
    if (cloneSample && response.status === 400 && /param incorrect|model|unsupported|not found/i.test(message)) throw new Error('当前 API 服务商可能尚未开放 mimo-v2.5-tts-voiceclone，请在服务商模型广场确认后再试')
    throw new Error(message)
  }
  const raw = await response.text()
  let body: any
  try { body = JSON.parse(raw) } catch { throw new Error('MiMo 语音服务返回了无法解析的数据') }
  const audioData = body.choices?.[0]?.message?.audio?.data || body.data?.audio?.data || body.audio?.data
  if (!audioData || typeof audioData !== 'string') throw new Error(body.error?.message || body.message || 'MiMo 语音服务未返回音频数据')
  const buffer = Buffer.from(audioData.replace(/^data:[^;]+;base64,/, ''), 'base64')
  if (!buffer.length) throw new Error('MiMo 语音服务返回了空音频')
  return saveNarration(buffer, 'wav', 'audio/wav', model, cloneSample ? `克隆音色：${cloneSample.name}` : voice, input)
}

function voiceDataUri(sample: VoiceSampleRow) {
  try { return `data:${sample.mime_type};base64,${readFileSync(sample.file_path).toString('base64')}` }
  catch { throw new Error(`克隆音色“${sample.name}”的本地样本文件已丢失`) }
}

function saveNarration(buffer: Buffer, extension: string, mimeType: string, model: string, voice: string, input: NarrationInput) {
  const stamp = Date.now(); const filePath = join(getStorageRoot(app), 'audio', `narration-${stamp}.${extension}`); mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, buffer)
  const title = input.title?.trim() || `旁白-${new Date(stamp).toLocaleString('zh-CN', { hour12: false }).replace(/[\/:]/g, '-')}`
  const provider = input.provider || 'MiMo'
  const speed = Math.min(4, Math.max(.25, input.speed || 1))
  const work = saveAudioWork({ title, prompt: input.text, provider, model, voice, speed, file_path: filePath, mime_type: mimeType, video_project_id: input.projectId ?? null })
  return { id: work.id, title: work.title, filePath, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, provider, model, voice: work.voice, speed: work.speed }
}

async function voiceApiError(response: Response) {
  const raw = await response.text(); let detail = raw
  try { const body = JSON.parse(raw); detail = body.error?.message || body.message || raw } catch {}
  if (response.status === 401) return '语音 API Key 无效或没有权限'
  return `${response.status} ${String(detail).slice(0, 300)}`
}
