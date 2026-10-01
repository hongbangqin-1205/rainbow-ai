import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDigitalHumanTask, findActiveDigitalHumanTask, getDigitalHumanTask, getDigitalHumanTaskByRequestId, getDigitalHumanTaskByUpstreamId, getVideoWork, listDigitalHumanTasks, saveVideoWork, updateDigitalHumanTask, type DigitalHumanTaskRow } from './database'
import { loadApiKey, loadModelConfig } from './modelConfig'
import { getStorageRoot } from './storageService'

export type DigitalHumanInput = { imagePath: string; text: string; ratio: string; resolution: string; duration: number; motion: string; provider?: string; videoModel?: string; projectId?: number; title?: string }
export type DigitalHumanProgress = (progress: number, message: string) => void

export function listDigitalHumanGenerationTasks(projectId?: number) { return listDigitalHumanTasks(projectId).map(taskResult) }

export async function generateDigitalHuman(requestId: string, input: DigitalHumanInput, signal: AbortSignal, onProgress: DigitalHumanProgress) {
  const prepared = prepare(input)
  const previousRequest = getDigitalHumanTaskByRequestId(requestId)
  if (previousRequest) return resumeDigitalHuman(previousRequest.id, signal, onProgress)
  const active = findActiveDigitalHumanTask(prepared.fingerprint)
  if (active) throw new Error(`相同参数的任务 #${active.id} 已提交，请在生成记录中点击“继续查询”，不要重复付费提交`)
  let task = createDigitalHumanTask({ request_id: requestId, fingerprint: prepared.fingerprint, video_project_id: input.projectId ?? null, title: prepared.title, prompt: prepared.spokenText, image_path: input.imagePath, provider: prepared.provider, model: prepared.model, ratio: prepared.ratio, resolution: prepared.resolution, duration: prepared.duration, motion: input.motion || 'natural' })
  progressTask(task.id, 5, '正在提交数字人视频任务', onProgress)
  try {
    const response = await submitVideo(prepared, signal)
    const raw = await response.text(); if (!response.ok) throw new Error(apiError(response.status, raw, '提交视频任务失败'))
    let upstreamTaskId = ''; try { const body = JSON.parse(raw); upstreamTaskId = body.id || body.task_id || body.data?.id || '' } catch {}
    if (!upstreamTaskId) throw new Error(`视频服务没有返回任务 ID：${raw.slice(0, 180)}`)
    task = updateDigitalHumanTask(task.id, { upstream_task_id: upstreamTaskId, status: 'submitted', progress: 15, message: '任务已提交到服务器，正在生成音画', error: null })
    onProgress(15, '任务 ID 已保存，正在等待服务器生成')
  } catch (error) {
    if (signal.aborted && task.upstream_task_id) updateDigitalHumanTask(task.id, { status: 'local_stopped', message: '已停止本地等待，服务器仍会继续生成和计费', error: null })
    else updateDigitalHumanTask(task.id, { status: 'failed', message: '任务提交失败，未取得服务器任务 ID', error: errorMessage(error) })
    throw error
  }
  return resumeDigitalHuman(task.id, signal, onProgress)
}

export async function recoverDigitalHuman(upstreamTaskId: string, requestId: string, input: DigitalHumanInput, signal: AbortSignal, onProgress: DigitalHumanProgress) {
  const id = upstreamTaskId.trim(); if (!id) throw new Error('请输入 DMXAPI 后台任务 ID')
  const existing = getDigitalHumanTaskByUpstreamId(id)
  if (existing) return resumeDigitalHuman(existing.id, signal, onProgress)
  const prepared = prepare(input)
  const task = createDigitalHumanTask({ request_id: requestId, fingerprint: `${prepared.fingerprint}:recovered:${id}`, upstreamTaskId: id, status: 'submitted', video_project_id: input.projectId ?? null, title: prepared.title, prompt: prepared.spokenText, image_path: input.imagePath, provider: prepared.provider, model: prepared.model, ratio: prepared.ratio, resolution: prepared.resolution, duration: prepared.duration, motion: input.motion || 'natural' })
  return resumeDigitalHuman(task.id, signal, onProgress)
}

export async function resumeDigitalHuman(taskId: number, signal: AbortSignal, onProgress: DigitalHumanProgress) {
  let task = getDigitalHumanTask(taskId); if (!task) throw new Error('数字人生成任务不存在')
  if (task.status === 'completed' && task.video_work_id) { const work = getVideoWork(task.video_work_id); if (work && existsSync(work.file_path)) return workResult(work, task.id) }
  if (!task.upstream_task_id) throw new Error('该任务尚未取得服务器任务 ID，无法继续查询')
  const config = loadModelConfig(task.provider || 'DMXAPI'); const apiKey = loadApiKey(task.provider || 'DMXAPI')
  if (!apiKey) throw new Error(`请先在“API 与模型”中配置 ${task.provider || 'DMXAPI'} API Key`)
  task = updateDigitalHumanTask(task.id, { status: 'querying', progress: Math.max(task.progress, 18), message: '正在查询服务器生成结果', error: null }); onProgress(task.progress, '正在查询服务器生成结果')
  try {
    const videoUrl = task.result_url || await queryVideo(config.base_url, apiKey, task.provider, task.upstream_task_id, task.model, signal, (progress, message) => progressTask(task!.id, progress, message, onProgress))
    updateDigitalHumanTask(task.id, { result_url: videoUrl, status: 'downloading', progress: 92, message: '服务器已生成，正在下载视频' }); onProgress(92, '服务器已生成，正在下载视频')
    const download = await fetch(videoUrl, { signal }); if (!download.ok) throw new Error(`下载生成视频失败：${download.status}`)
    const buffer = Buffer.from(await download.arrayBuffer()); if (!buffer.length) throw new Error('视频服务返回了空文件')
    const directory = join(getStorageRoot(app), 'works', 'videos'); mkdirSync(directory, { recursive: true })
    const filePath = join(directory, `digital-human-${task.id}-${Date.now()}.mp4`); writeFileSync(filePath, buffer)
    const row = saveVideoWork({ title: task.title, prompt: task.prompt, provider: task.provider, model: task.model, ratio: task.ratio, resolution: task.resolution, duration: task.duration, file_path: filePath, mime_type: 'video/mp4', video_project_id: task.video_project_id, source_image_path: task.image_path })
    updateDigitalHumanTask(task.id, { status: 'completed', progress: 100, message: '数字人视频已同步到我的作品', file_path: filePath, video_work_id: row.id, error: null }); onProgress(100, '数字人视频已同步到“我的作品”')
    return workResult(row, task.id)
  } catch (error) {
    if (signal.aborted) updateDigitalHumanTask(task.id, { status: 'local_stopped', message: '已停止本地等待，服务器仍会继续生成和计费', error: null })
    else updateDigitalHumanTask(task.id, { status: 'submitted', message: '本次查询未取得结果，可稍后继续查询', error: errorMessage(error) })
    throw error
  }
}

function prepare(input: DigitalHumanInput) {
  const provider = input.provider || 'DMXAPI'; const config = loadModelConfig(provider); const apiKey = loadApiKey(provider); if (!apiKey) throw new Error(`请先在“API 与模型”中配置 ${provider} API Key`)
  const model = input.videoModel || config.video_model || (provider === '极客智坊' ? 'doubao-seedance-2.0' : 'doubao-seedance-2-0-260128')
  if (provider === 'DMXAPI' && !/seedance/i.test(model)) throw new Error('DMXAPI 数字人直出需要 Seedance 视频模型')
  if (provider === '极客智坊' && !['doubao-seedance-2.0', 'kling-video-v3'].includes(model)) throw new Error(`GeekAI 暂不支持 ${model} 的数字人视频适配`)
  const image = imageDataUri(input.imagePath); const spokenText = input.text.trim(); if (!spokenText) throw new Error('请先准备数字人口播文案')
  const duration = Math.min(15, Math.max(4, Math.round(input.duration || 5))); const ratio = input.ratio || '9:16'; const resolution = input.resolution || '720p'
  const prompt = `画面中的人物保持身份、五官、服装和背景高度一致，正面面对镜头，用自然表情、清晰准确的口型说：“${spokenText.slice(0, 500)}”。${motionPrompt(input.motion)}。固定机位，避免切镜，避免出现字幕和文字。`
  const file = statSync(input.imagePath); const fingerprint = createHash('sha256').update(JSON.stringify([input.imagePath, file.size, file.mtimeMs, spokenText, model, ratio, resolution, duration, input.motion])).digest('hex')
  return { apiKey, provider, baseUrl: config.base_url.replace(/\/$/, ''), model, image, spokenText, duration, ratio, resolution, prompt, fingerprint, title: input.title?.trim() || `数字人口播-${new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\/:]/g, '-')}` }
}

function progressTask(id: number, progress: number, message: string, notify: DigitalHumanProgress) { updateDigitalHumanTask(id, { progress, message }); notify(progress, message) }
function taskResult(task: DigitalHumanTaskRow) { return { ...task, dataUrl: task.file_path && existsSync(task.file_path) ? pathToFileURL(task.file_path).href : '' } }
function workResult(work: NonNullable<ReturnType<typeof getVideoWork>>, taskId: number) { return { taskId, id: work.id, title: work.title, filePath: work.file_path, dataUrl: pathToFileURL(work.file_path).href, provider: work.provider, model: work.model, ratio: work.ratio, resolution: work.resolution, duration: work.duration } }
function imageDataUri(path: string) { const size = statSync(path).size; if (size > 30 * 1024 * 1024) throw new Error('数字人形象图片不能超过 30 MB'); const extension = extname(path).toLowerCase(); const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : ''; if (!mime) throw new Error('数字人形象仅支持 PNG、JPG、JPEG 或 WebP'); return `data:${mime};base64,${readFileSync(path).toString('base64')}` }
function authHeaders(apiKey: string) { return { Authorization: apiKey, 'content-type': 'application/json' } }
function motionPrompt(value: string) { return value === 'expressive' ? '人物有适度手势和丰富但自然的表情' : value === 'calm' ? '人物动作克制稳定，仅有轻微眨眼和自然呼吸' : '人物有轻微自然的头部和手部动作' }

async function submitVideo(prepared: ReturnType<typeof prepare>, signal: AbortSignal) {
  if (prepared.provider === '极客智坊') {
    const quality = prepared.resolution === '1080p' ? 'pro' : 'std'
    const response = await fetch(`${prepared.baseUrl}/videos/generations`, { method: 'POST', signal, headers: { Authorization: `Bearer ${prepared.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: prepared.model, prompt: prepared.prompt, image: prepared.image, duration: prepared.duration, aspect_ratio: prepared.ratio, quality, with_audio: true, watermark: false, async: true }) })
    return response
  }
  return fetch(`${prepared.baseUrl}/responses`, { method: 'POST', signal, headers: authHeaders(prepared.apiKey), body: JSON.stringify({ model: prepared.model, input: [{ type: 'text', text: prepared.prompt }, { type: 'image_url', image_url: { url: prepared.image }, role: 'first_frame' }], generate_audio: true, resolution: prepared.resolution, ratio: prepared.ratio, duration: prepared.duration, seed: -1, camera_fixed: true, watermark: false }) })
}

async function queryVideo(baseUrl: string, apiKey: string, provider: string, taskId: string, submitModel: string, signal: AbortSignal, onProgress: DigitalHumanProgress) {
  if (provider === '极客智坊') return queryGeekVideo(baseUrl, apiKey, taskId, signal, onProgress)
  const queryModel = /seedance-2/i.test(submitModel) ? 'seedance-2-0-get' : 'seedance-get'
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/responses`, { method: 'POST', signal, headers: authHeaders(apiKey), body: JSON.stringify({ model: queryModel, input: taskId, stream: true }) })
  if (!response.ok) throw new Error(apiError(response.status, await response.text(), '查询视频任务失败')); if (!response.body) throw new Error('视频查询服务没有返回数据流')
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; let videoUrl = ''; let steps = 0
  while (true) { const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const lines = pending.split(/\r?\n/); pending = lines.pop() || ''; for (const line of lines) { const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim(); if (!text || text.startsWith('event:') || text === '[DONE]') continue; steps += 1; onProgress(Math.min(88, 18 + steps * 3), '服务器正在生成数字人口播视频'); try { const event = JSON.parse(text); videoUrl ||= extractVideoUrl(event) } catch {} } }
  if (!videoUrl && pending.trim()) { try { videoUrl = extractVideoUrl(JSON.parse(pending.replace(/^data:\s*/, ''))) } catch {} }
  if (!videoUrl) throw new Error('服务器暂未返回视频地址，请稍后在生成记录中继续查询'); return videoUrl
}

async function queryGeekVideo(baseUrl: string, apiKey: string, taskId: string, signal: AbortSignal, onProgress: DigitalHumanProgress) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/videos/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal })
  if (!response.ok) throw new Error(apiError(response.status, await response.text(), '查询 GeekAI 视频任务失败'))
  const body = await response.json() as any; const status = String(body.task_status || body.status || '').toLowerCase(); onProgress(status === 'succeed' ? 88 : 45, status === 'succeed' ? 'GeekAI 视频已生成' : `GeekAI 视频任务状态：${status || '处理中'}`)
  if (status === 'failed' || status === 'error') throw new Error(body.error?.message || body.message || 'GeekAI 视频任务生成失败')
  const url = body.video_result?.[0]?.url || body.video_url || body.url
  if (status !== 'succeed' || typeof url !== 'string') throw new Error('GeekAI 视频尚未完成，请稍后继续查询')
  return url
}

function extractVideoUrl(value: any): string { const direct = value?.video_url || value?.url || value?.data?.video_url || value?.data?.url; if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct; const text = value?.response?.output?.[0]?.content?.[0]?.text || value?.output?.[0]?.content?.[0]?.text || ''; if (typeof text !== 'string') return ''; try { const parsed = JSON.parse(text); const url = parsed?.content?.video_url || parsed?.video_url || parsed?.url; if (typeof url === 'string') return url } catch {}; return text.match(/(?:视频URL[:：]\s*|"video_url"\s*:\s*")?(https?:\/\/[^\s"}]+)/)?.[1] || '' }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function apiError(status: number, raw: string, fallback: string) { let detail = raw; try { const body = JSON.parse(raw); detail = body.error?.message || body.message || body.ErrMsg || raw } catch {}; if (status === 401) return 'DMXAPI Key 无效或没有视频模型权限'; if (status === 429) return 'DMXAPI 请求过于频繁或账户额度不足'; return `${fallback}：${status} ${String(detail).slice(0, 260)}` }
