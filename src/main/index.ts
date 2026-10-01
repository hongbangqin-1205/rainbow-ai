import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { addMessage, addWorkToProject, checkpointDatabase, createAgentRun, createConversation, createProject, createPublishAccount, createPublications, createTask, createVideoProject, createVideoSource, createVoiceSample, deleteConversation, deleteProject, deletePublication, deletePublishAccount, deleteTask, deleteVideoGeneration, deleteVideoSource, deleteVoiceSample, deleteWork, failTask, finishAgentRun, finishAgentStep, finishTask, getImageWork, getPublication, getVideoProject, getVideoSource, getVideoTranscript, linkWorkTask, listAgentRuns, listAudioWorks, listConversations, listDuePublications, listDueTasks, listImageWorks, listMessages, listProjects, listPublications, listPublishAccounts, listRuns, listTasks, listTextWorks, listUnifiedWorks, listUnifiedWorksByKeys, listUnifiedWorksPage, listVideoGenerations, listVideoProjects, listVideoSources, listVideoWorks, listVoiceSamples, openDatabase, renameVoiceSample, runTask, saveTextWork, saveVideoGeneration, saveVideoTranscript, setPublicationStatus, setVideoSourceStatus, startAgentStep, touchConversation, updateConversation, updateMessage, updateProject, updatePublication, updatePublishAccount, updateTask, updateVideoProject, updateWorkMeta, type UnifiedWorkRow, type VoiceSampleRow, type WorkType, type WorksPageInput } from './database'
import { listAsrProviderConfigs, listImageProviderConfigs, listTextProviderConfigs, listVideoProviderConfigs, listVoiceProviderConfigs, loadModelConfig, persistModelConfig, resolveImageConfig, resolveTextConfig, testModelConnection, type ModelConfigInput } from './modelConfig'
import { streamModelReply } from './chatService'
import { generateImages, type ImageGenerationInput } from './imageService'
import { clearPublishAuthorization, executePublication, getAuthorizationSummary, openPlatformAuthorization, removePublishSecret, saveBrowserAuthorization, saveCookieAuthorization, testPublishAuthorization, validatePublication } from './publishService'
import { detectVideoPlatform, downloadWhisperSmall, extractVideoUrl, getWhisperStatus, installWhisperEngine, probeVideo, transcribeApiMedia, transcribeLocalVideo, transcribeOnlineVideo } from './videoService'
import { createVideoCopy, type VideoCopyInput } from './videoCopyService'
import { generateNarration, type NarrationInput } from './voiceService'
import { generateDigitalHuman, listDigitalHumanGenerationTasks, recoverDigitalHuman, resumeDigitalHuman, type DigitalHumanInput } from './digitalHumanService'
import { composePersonalVideo, type PersonalVideoInput } from './personalVideoService'
import { polishVideo, type PolishVideoInput } from './polishVideoService'
import { getStorageRoot, migrateStorage, storageStatus } from './storageService'
import { createRainbowAgent, type AgentApprovalDecision, type AgentApprovalRequest, type AgentPermissionMode } from './agentService'
import type { AgentSession } from '@earendil-works/pi-coding-agent'

let mainWindow: BrowserWindow | null = null
let scheduler: NodeJS.Timeout | null = null
const chatControllers = new Map<string, AbortController>()
const cancelledChats = new Set<string>()
const agentSessions = new Map<string, AgentSession>()
const cancelledAgents = new Set<string>()
const pendingAgentApprovals = new Map<string, { requestId: string; senderId: number; resolve: (decision: AgentApprovalDecision) => void; timer: NodeJS.Timeout }>()
const imageControllers = new Map<string, AbortController>()
const videoControllers = new Map<string, AbortController>()

function requestAgentApproval(sender: Electron.WebContents, request: AgentApprovalRequest) {
  return new Promise<AgentApprovalDecision>((resolve) => {
    const approvalId = randomUUID()
    const timer = setTimeout(() => { pendingAgentApprovals.delete(approvalId); resolve('deny') }, 120_000)
    pendingAgentApprovals.set(approvalId, { requestId: request.requestId, senderId: sender.id, resolve, timer })
    sender.send('agent:approval', { approvalId, ...request })
  })
}

function cancelAgentApprovals(requestId: string) {
  for (const [approvalId, pending] of pendingAgentApprovals) if (pending.requestId === requestId) { clearTimeout(pending.timer); pending.resolve('deny'); pendingAgentApprovals.delete(approvalId) }
}

function voiceSampleMime(extension: string) {
  return ({ '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac' } as Record<string, string>)[extension.toLowerCase()] || 'application/octet-stream'
}
function voiceSampleResult(sample: VoiceSampleRow) {
  let dataUrl = ''
  if (existsSync(sample.file_path)) dataUrl = `data:${sample.mime_type};base64,${readFileSync(sample.file_path).toString('base64')}`
  return { ...sample, data_url: dataUrl, missing: dataUrl ? 0 : 1 }
}
function voiceSampleTarget(extension: string) {
  const directory = join(getStorageRoot(app), 'audio', 'voice-samples'); mkdirSync(directory, { recursive: true })
  return join(directory, `voice-sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`)
}

function workThumbnailPath(work: UnifiedWorkRow) {
  if (work.type !== 'image' || !work.file_path || !existsSync(work.file_path)) return ''
  const cacheDirectory = join(getStorageRoot(app), 'cache', 'work-thumbnails'); mkdirSync(cacheDirectory, { recursive: true })
  const modified = Math.floor(statSync(work.file_path).mtimeMs)
  const target = join(cacheDirectory, `${work.id}-${modified}.png`)
  if (!existsSync(target)) {
    const image = nativeImage.createFromPath(work.file_path)
    if (!image.isEmpty()) writeFileSync(target, image.resize({ width: 480, quality: 'good' }).toPNG())
  }
  return existsSync(target) ? pathToFileURL(target).href : ''
}

function decorateWork(work: UnifiedWorkRow, mode: 'metadata' | 'thumbnail' | 'preview' = 'metadata') {
  const available = !work.file_path || existsSync(work.file_path)
  const dataUrl = mode === 'preview' && available && work.file_path ? pathToFileURL(work.file_path).href : mode === 'thumbnail' ? workThumbnailPath(work) : ''
  return { ...work, missing: available ? 0 : 1, data_url: dataUrl }
}

async function executeTask(id: number, title = '任务') {
  const run = runTask(id)
  mainWindow?.webContents.send('tasks:updated', id)
  try {
    await new Promise((resolve) => setTimeout(resolve, 700))
    const result = finishTask(run.runId, id)
    if (Notification.isSupported()) new Notification({ title: 'Rainbow AI 任务完成', body: title }).show()
    mainWindow?.webContents.send('tasks:updated', id)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    failTask(run.runId, id, message)
    mainWindow?.webContents.send('tasks:updated', id)
    throw error
  }
}

function startScheduler() {
  if (scheduler) clearInterval(scheduler)
  const check = () => { for (const task of listDueTasks()) void executeTask(task.id, task.title); for (const publication of listDuePublications()) void executePublication(publication.id).then((row) => { if (row && Notification.isSupported()) new Notification({ title: row.status === 'published' ? 'Rainbow AI 发布完成' : 'Rainbow AI 等待发布确认', body: row.title }).show(); mainWindow?.webContents.send('publications:updated', publication.id) }).catch(() => mainWindow?.webContents.send('publications:updated', publication.id)) }
  scheduler = setInterval(check, 30_000)
  setTimeout(check, 1_500)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    title: 'Rainbow AI',
    minWidth: 1100,
    minHeight: 720,
    show: true,
    backgroundColor: '#090a18',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Rainbow AI] renderer load failed: ${errorCode} ${errorDescription}`)
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[Rainbow AI] preload failed: ${preloadPath}`, error)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm'] }] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('video:projects:list', () => listVideoProjects())
ipcMain.handle('video:projects:create', (_event, title?: string) => createVideoProject(title))
ipcMain.handle('video:projects:load', (_event, id: number) => ({ project: getVideoProject(id), sources: listVideoSources(id).map((source) => ({ ...source, transcript: getVideoTranscript(source.id) ?? null })), generations: listVideoGenerations(id) }))
ipcMain.handle('video:projects:update', (_event, id: number, input: { title: string; mode: string; language: string; targetLength: number; draft: string }) => updateVideoProject(id, input))
ipcMain.handle('video:sources:add-url', (_event, projectId: number, value: string) => {
  const url = extractVideoUrl(value.trim()); const platform = detectVideoPlatform(url)
  if (!url || !platform) throw new Error('未识别到有效链接，请粘贴视频链接或完整分享口令')
  return createVideoSource(projectId, { sourceType: 'url', sourceValue: url, displayName: `${platform}视频链接`, platform, status: 'ready' })
})
ipcMain.handle('video:sources:add-file', async (_event, projectId: number) => {
  const result = await dialog.showOpenDialog({ title: '选择需要解析的视频', properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]; const meta = await probeVideo(path)
  return createVideoSource(projectId, { sourceType: 'file', sourceValue: path, displayName: meta.displayName, platform: '本地文件', status: 'ready', duration: meta.duration, fileSize: meta.fileSize })
})
ipcMain.handle('video:sources:add-text', (_event, projectId: number, content: string) => {
  const trimmed = content.trim(); if (!trimmed) throw new Error('请输入文案内容')
  const source = createVideoSource(projectId, { sourceType: 'text', sourceValue: trimmed, displayName: trimmed.slice(0, 24), platform: '手动文案', status: 'completed' })
  saveVideoTranscript(source.id, { engine: 'manual', language: 'zh', content: trimmed, status: 'completed' }); return source
})
ipcMain.handle('video:sources:delete', (_event, id: number) => { deleteVideoSource(id); return true })
ipcMain.handle('video:sources:transcribe', async (_event, id: number, language: string, engine: 'local' | 'api' = 'local', provider?: string) => {
  const source = getVideoSource(id)
  if (!source) throw new Error('视频来源不存在')
  if (source.source_type === 'text') return saveVideoTranscript(id, { engine: 'manual', language, content: source.source_value, status: 'completed' })
  const requestId = `source-${id}`; videoControllers.get(requestId)?.abort(); const controller = new AbortController(); videoControllers.set(requestId, controller)
  setVideoSourceStatus(id, 'processing')
  const engineName = engine === 'api' ? `api:${provider || '未配置'}` : 'whisper-small'
  try { const content = source.source_type === 'url' ? await transcribeOnlineVideo(source.source_value, language, controller.signal, (progress, message) => mainWindow?.webContents.send('video:source:progress', { sourceId: id, progress, message }), engine, provider) : engine === 'api' ? await transcribeApiMedia(source.source_value, language, provider || '', controller.signal) : await transcribeLocalVideo(source.source_value, language, controller.signal); setVideoSourceStatus(id, 'completed'); return saveVideoTranscript(id, { engine: engineName, language, content, status: 'completed' }) }
  catch (error) { const message = controller.signal.aborted ? '已停止解析' : error instanceof Error ? error.message : '转写失败'; setVideoSourceStatus(id, 'failed', message); saveVideoTranscript(id, { engine: engineName, language, content: '', status: 'failed', error: message }); if (controller.signal.aborted) throw new Error(message); throw error }
  finally { videoControllers.delete(requestId) }
})
ipcMain.handle('video:sources:stop', (_event, id: number) => { videoControllers.get(`source-${id}`)?.abort(); return true })
ipcMain.handle('video:copy:generate', async (_event, requestId: string, projectId: number, input: VideoCopyInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { const result = await createVideoCopy(input, controller); return saveVideoGeneration(projectId, { kind: input.action === 'generate' ? (input.mode === 'breakdown' ? 'breakdown' : 'draft') : input.action, mode: input.mode, content: result.content, provider: result.provider, model: result.model, parameters: JSON.stringify(input) }) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:copy:stop', (_event, requestId: string) => { videoControllers.get(requestId)?.abort(); return true })
ipcMain.handle('video:copy:delete', (_event, id: number) => { deleteVideoGeneration(id); return true })
ipcMain.handle('video:voice:providers', () => listVoiceProviderConfigs())
ipcMain.handle('video:asr:providers', () => listAsrProviderConfigs())
ipcMain.handle('video:voice:generate', async (_event, requestId: string, input: NarrationInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await generateNarration(input, controller.signal) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:voice:samples:list', () => listVoiceSamples().map(voiceSampleResult))
ipcMain.handle('video:voice:samples:upload', async (_event, name: string, authorized: boolean) => {
  if (!authorized) throw new Error('请先确认已获得该声音的合法授权')
  const result = await dialog.showOpenDialog({ title: '选择声音样本', properties: ['openFile'], filters: [{ name: 'MiMo 支持的音频', extensions: ['wav', 'mp3'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const source = result.filePaths[0]; const size = statSync(source).size
  if (size > 7_500_000) throw new Error('声音样本过大：MiMo 要求 Base64 编码后不超过 10 MB，请选择 7.5 MB 以内的 MP3/WAV')
  const extension = extname(source).toLowerCase(); const target = voiceSampleTarget(extension); copyFileSync(source, target)
  const sample = createVoiceSample({ name: name.trim() || basename(source, extension), filePath: target, mimeType: voiceSampleMime(extension), fileSize: size, sourceType: 'upload', authorized: true })
  return voiceSampleResult(sample)
})
ipcMain.handle('video:voice:samples:save-recording', (_event, name: string, bytes: Uint8Array, mimeType: string, authorized: boolean) => {
  if (!authorized) throw new Error('请先确认已获得该声音的合法授权')
  const buffer = Buffer.from(bytes); if (!buffer.length) throw new Error('录音内容为空，请重新录制'); if (buffer.length > 7_500_000) throw new Error('录音过长：MiMo 要求 Base64 编码后不超过 10 MB，请缩短录音后重试')
  const extension = mimeType.includes('ogg') ? '.ogg' : mimeType.includes('wav') ? '.wav' : mimeType.includes('mp4') ? '.m4a' : '.webm'
  const target = voiceSampleTarget(extension); writeFileSync(target, buffer)
  const sample = createVoiceSample({ name: name.trim() || `我的录音 ${new Date().toLocaleString('zh-CN')}`, filePath: target, mimeType: voiceSampleMime(extension), fileSize: buffer.length, sourceType: 'recording', authorized: true })
  return voiceSampleResult(sample)
})
ipcMain.handle('video:voice:samples:rename', (_event, id: number, name: string) => { const trimmed = name.trim(); if (!trimmed) throw new Error('请输入音色名称'); const sample = renameVoiceSample(id, trimmed); return sample ? voiceSampleResult(sample) : null })
ipcMain.handle('video:voice:samples:delete', (_event, id: number) => { const sample = deleteVoiceSample(id); if (sample?.file_path && existsSync(sample.file_path)) unlinkSync(sample.file_path); return true })
ipcMain.handle('video:digital-human:select-image', async () => { const result = await dialog.showOpenDialog({ title: '选择数字人形象图片', properties: ['openFile'], filters: [{ name: '人物图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (result.canceled || !result.filePaths[0]) return null; const path = result.filePaths[0]; if (statSync(path).size > 30 * 1024 * 1024) throw new Error('形象图片不能超过 30 MB'); const mime = ['.jpg', '.jpeg'].includes(extname(path).toLowerCase()) ? 'image/jpeg' : extname(path).toLowerCase() === '.webp' ? 'image/webp' : 'image/png'; return { path, name: basename(path), dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` } })
ipcMain.handle('video:digital-human:providers', () => listVideoProviderConfigs())
ipcMain.handle('video:digital-human:list', (_event, projectId?: number) => listDigitalHumanGenerationTasks(projectId))
ipcMain.handle('video:digital-human:generate', async (_event, requestId: string, input: DigitalHumanInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await generateDigitalHuman(requestId, input, controller.signal, (progress, message) => mainWindow?.webContents.send('video:digital-human:progress', { requestId, progress, message })) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:digital-human:resume', async (_event, requestId: string, taskId: number) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await resumeDigitalHuman(taskId, controller.signal, (progress, message) => mainWindow?.webContents.send('video:digital-human:progress', { requestId, progress, message })) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:digital-human:recover', async (_event, requestId: string, upstreamTaskId: string, input: DigitalHumanInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await recoverDigitalHuman(upstreamTaskId, requestId, input, controller.signal, (progress, message) => mainWindow?.webContents.send('video:digital-human:progress', { requestId, progress, message })) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:digital-human:stop', (_event, requestId: string) => { videoControllers.get(requestId)?.abort(); return true })
ipcMain.handle('video:personal:audio-works', () => listAudioWorks().map((item) => ({ ...item, missing: existsSync(item.file_path) ? 0 : 1, dataUrl: existsSync(item.file_path) ? pathToFileURL(item.file_path).href : '' })))
ipcMain.handle('video:personal:select-video', async () => { const result = await dialog.showOpenDialog({ title: '选择本人出镜视频', properties: ['openFile'], filters: [{ name: '人物视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] }); if (result.canceled || !result.filePaths[0]) return null; const path = result.filePaths[0]; const meta = await probeVideo(path); return { path, name: meta.displayName, duration: meta.duration, fileSize: meta.fileSize, dataUrl: pathToFileURL(path).href } })
ipcMain.handle('video:personal:compose', async (_event, requestId: string, input: PersonalVideoInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await composePersonalVideo(input, controller.signal, (progress, message) => mainWindow?.webContents.send('video:personal:progress', { requestId, progress, message })) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:personal:stop', (_event, requestId: string) => { videoControllers.get(requestId)?.abort(); return true })
ipcMain.handle('video:polish:video-works', () => listVideoWorks().filter((item) => existsSync(item.file_path)).map((item) => ({ ...item, dataUrl: pathToFileURL(item.file_path).href })))
ipcMain.handle('video:polish:select-video', async () => { const result = await dialog.showOpenDialog({ title: '选择需要润色的视频', properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] }); if (result.canceled || !result.filePaths[0]) return null; const path = result.filePaths[0]; const meta = await probeVideo(path); return { path, name: meta.displayName, duration: meta.duration, dataUrl: pathToFileURL(path).href } })
ipcMain.handle('video:polish:select-music', async () => { const result = await dialog.showOpenDialog({ title: '选择背景音乐', properties: ['openFile'], filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }] }); if (result.canceled || !result.filePaths[0]) return null; const path = result.filePaths[0]; return { path, name: basename(path), dataUrl: pathToFileURL(path).href } })
ipcMain.handle('video:polish:render', async (_event, requestId: string, input: PolishVideoInput) => { const controller = new AbortController(); videoControllers.set(requestId, controller); try { return await polishVideo(input, controller.signal, (progress, message) => mainWindow?.webContents.send('video:polish:progress', { requestId, progress, message })) } finally { videoControllers.delete(requestId) } })
ipcMain.handle('video:polish:stop', (_event, requestId: string) => { videoControllers.get(requestId)?.abort(); return true })
ipcMain.handle('video:whisper:status', () => getWhisperStatus())
ipcMain.handle('video:whisper:download', async () => downloadWhisperSmall((progress, received, total) => mainWindow?.webContents.send('video:whisper:progress', { progress, received, total })))
ipcMain.handle('video:whisper:install-engine', async () => installWhisperEngine((progress, received, total, phase) => mainWindow?.webContents.send('video:whisper:progress', { progress, received, total, phase })))
ipcMain.handle('video:whisper:select-engine', async () => {
  const result = await dialog.showOpenDialog({ title: '选择 whisper-cli.exe', properties: ['openFile'], filters: [{ name: 'Whisper CLI', extensions: ['exe'] }] })
  if (result.canceled || !result.filePaths[0]) return getWhisperStatus()
  const target = join(getStorageRoot(app), 'video-studio', 'tools', 'whisper-cli.exe'); mkdirSync(join(getStorageRoot(app), 'video-studio', 'tools'), { recursive: true }); copyFileSync(result.filePaths[0], target); return getWhisperStatus()
})

ipcMain.handle('projects:list', () => listProjects())
ipcMain.handle('projects:create', (_event, name: string, description?: string) => createProject(name, description))
ipcMain.handle('projects:update', (_event, id: number, name: string, description?: string) => updateProject(id, name, description))
ipcMain.handle('projects:delete', (_event, id: number) => { deleteProject(id); return true })
ipcMain.handle('tasks:list', (_event, projectId: number) => listTasks(projectId))
ipcMain.handle('tasks:create', (_event, projectId: number, title: string, schedule?: string) => createTask(projectId, title, schedule))
ipcMain.handle('tasks:update', (_event, id: number, title: string, schedule: string, status: string, enabled?: boolean) => updateTask(id, title, schedule, status, enabled))
ipcMain.handle('tasks:delete', (_event, id: number) => { deleteTask(id); return true })
ipcMain.handle('tasks:runs', (_event, projectId: number) => listRuns(projectId))
ipcMain.handle('tasks:run', async (_event, id: number, title?: string) => executeTask(id, title))
ipcMain.handle('model-config:get', (_event, provider: string) => loadModelConfig(provider))
ipcMain.handle('model-config:save', (_event, config: ModelConfigInput, apiKey?: string) => persistModelConfig(config, apiKey))
ipcMain.handle('model-config:test', (_event, config: ModelConfigInput, apiKey?: string) => testModelConnection(config, apiKey))
ipcMain.handle('chat:providers', () => listTextProviderConfigs())
ipcMain.handle('conversations:list', () => listConversations())
ipcMain.handle('conversations:create', (_event, title: string, provider: string, model: string) => createConversation(title, provider, model))
ipcMain.handle('conversations:update', (_event, id: number, title: string, provider?: string, model?: string) => updateConversation(id, title, provider, model))
ipcMain.handle('conversations:delete', (_event, id: number) => { deleteConversation(id); return true })
ipcMain.handle('messages:list', (_event, conversationId: number) => listMessages(conversationId))
ipcMain.handle('works:text:list', () => listTextWorks())
ipcMain.handle('works:text:save', (_event, title: string, content: string, conversationId?: number) => saveTextWork(title, content, conversationId))
ipcMain.handle('works:list', () => listUnifiedWorks().map((work) => decorateWork(work)))
ipcMain.handle('works:page', (_event, input: WorksPageInput) => { const result = listUnifiedWorksPage(input); return { ...result, items: result.items.map((work) => decorateWork(work, 'thumbnail')) } })
ipcMain.handle('works:by-keys', (_event, keys: string[]) => listUnifiedWorksByKeys(keys).map((work) => decorateWork(work, 'thumbnail')))
ipcMain.handle('works:preview', (_event, type: WorkType, id: number) => { const work = listUnifiedWorksByKeys([`${type}-${id}`])[0]; return work ? decorateWork(work, 'preview') : null })
ipcMain.handle('works:update', (_event, type: WorkType, id: number, input: { title: string; favorite: boolean; tags: string }) => { updateWorkMeta(type, id, input); return true })
ipcMain.handle('works:delete', (_event, type: WorkType, id: number) => { const path = deleteWork(type, id); if (path && existsSync(path)) unlinkSync(path); return true })
ipcMain.handle('works:export-text', async (_event, id: number, title: string, content: string) => { const result = await dialog.showSaveDialog({ defaultPath: `${title.replace(/[\\/:*?\"<>|]/g, '_') || `文本作品-${id}`}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本', extensions: ['txt'] }] }); if (result.canceled || !result.filePath) return false; const { writeFileSync } = await import('node:fs'); writeFileSync(result.filePath, content, 'utf8'); return true })
ipcMain.handle('works:open-location', (_event, path: string) => existsSync(path) ? shell.showItemInFolder(path) : false)
ipcMain.handle('works:download-file', async (_event, sourcePath: string, title: string) => { if (!sourcePath || !existsSync(sourcePath)) throw new Error('本地作品文件不存在'); const extension = sourcePath.split('.').pop() || 'bin'; const result = await dialog.showSaveDialog({ defaultPath: `${title.replace(/[\\/:*?\"<>|]/g, '_')}.${extension}` }); if (result.canceled || !result.filePath) return false; copyFileSync(sourcePath, result.filePath); return true })
ipcMain.handle('works:add-project', (_event, type: WorkType, id: number, projectId: number) => { addWorkToProject(type, id, projectId); return true })
ipcMain.handle('works:create-task', (_event, type: WorkType, id: number, projectId: number, title: string) => { const task = createTask(projectId, title); linkWorkTask(type, id, task.id); return task })
ipcMain.handle('works:backup', async () => { const result = await dialog.showOpenDialog({ title: '选择作品备份文件夹', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled) return null; const root = join(result.filePaths[0], `Rainbow-作品备份-${new Date().toISOString().slice(0, 10)}`); mkdirSync(root, { recursive: true }); const imageDir = join(root, 'images'); const audioDir = join(root, 'audio'); const videoDir = join(root, 'videos'); mkdirSync(imageDir, { recursive: true }); mkdirSync(audioDir, { recursive: true }); mkdirSync(videoDir, { recursive: true }); const works = listUnifiedWorks(); for (const work of works) { if (work.type === 'image' && existsSync(work.file_path)) copyFileSync(work.file_path, join(imageDir, `${work.id}-${basename(work.file_path)}`)); if (work.type === 'audio' && existsSync(work.file_path)) copyFileSync(work.file_path, join(audioDir, `${work.id}-${basename(work.file_path)}`)); if (work.type === 'video' && existsSync(work.file_path)) copyFileSync(work.file_path, join(videoDir, `${work.id}-${basename(work.file_path)}`)) } const manifest = JSON.stringify(works.map(({ file_path, ...work }) => ({ ...work, file_name: file_path ? basename(file_path) : '' })), null, 2); const { writeFileSync } = await import('node:fs'); writeFileSync(join(root, 'works.json'), manifest, 'utf8'); checkpointDatabase(); copyFileSync(join(getStorageRoot(app), 'data', 'rainbow.db'), join(root, 'rainbow.db')); return root })
ipcMain.handle('storage:status', () => storageStatus(app))
ipcMain.handle('storage:choose', async () => {
  const result = await dialog.showOpenDialog({ title: '选择 Rainbow AI 作品存储位置', properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  checkpointDatabase(); const status = migrateStorage(result.filePaths[0], app)
  setTimeout(() => { app.relaunch(); app.exit(0) }, 700)
  return status
})
ipcMain.handle('publish:accounts:list', () => listPublishAccounts().map((account) => ({ ...account, ...getAuthorizationSummary(account.id) })))
ipcMain.handle('publish:accounts:create', (_event, input: { platform: string; name: string; handle: string; simulation: boolean; authMethod?: 'browser'; browser?: 'edge' | 'chrome' }) => { const account = createPublishAccount(input); if (!input.simulation && input.authMethod === 'browser') saveBrowserAuthorization(account.id, input.browser === 'chrome' ? 'chrome' : 'edge'); return { ...account, ...getAuthorizationSummary(account.id) } })
ipcMain.handle('publish:accounts:update', (_event, id: number, input: { platform: string; name: string; handle: string; enabled: boolean; simulation: boolean }) => { const account = updatePublishAccount(id, input); return { ...account, ...getAuthorizationSummary(id) } })
ipcMain.handle('publish:accounts:delete', (_event, id: number) => { deletePublishAccount(id); removePublishSecret(id); return true })
ipcMain.handle('publish:accounts:test', (_event, id: number) => testPublishAuthorization(id))
ipcMain.handle('publish:accounts:authorize-browser', (_event, id: number, browser: 'edge' | 'chrome') => saveBrowserAuthorization(id, browser === 'chrome' ? 'chrome' : 'edge'))
ipcMain.handle('publish:accounts:import-cookies', async (_event, id: number) => { const result = await dialog.showOpenDialog({ title: '选择 cookies.txt', properties: ['openFile'], filters: [{ name: 'Cookie 文件', extensions: ['txt'] }] }); if (result.canceled || !result.filePaths[0]) return null; const path = result.filePaths[0]; if (statSync(path).size > 5 * 1024 * 1024) throw new Error('Cookie 文件不能超过 5MB'); return saveCookieAuthorization(id, readFileSync(path, 'utf8'), basename(path)) })
ipcMain.handle('publish:accounts:clear-auth', (_event, id: number) => clearPublishAuthorization(id))
ipcMain.handle('publish:accounts:open-login', (_event, id: number) => openPlatformAuthorization(id))
ipcMain.handle('publish:list', () => listPublications())
ipcMain.handle('publish:create', (_event, input: { accountIds: number[]; projectId?: number | null; title: string; body: string; topics: string; status: string; scheduledAt?: string | null; workKeys: string[] }) => createPublications(input))
ipcMain.handle('publish:update', (_event, id: number, input: { accountId: number; projectId?: number | null; title: string; body: string; topics: string; status: string; scheduledAt?: string | null; workKeys: string[] }) => updatePublication(id, input))
ipcMain.handle('publish:validate', (_event, id: number) => validatePublication(id))
ipcMain.handle('publish:run', async (_event, id: number) => { const row = await executePublication(id); mainWindow?.webContents.send('publications:updated', id); return row })
ipcMain.handle('publish:cancel', (_event, id: number) => setPublicationStatus(id, 'cancelled', '发布计划已取消'))
ipcMain.handle('publish:retry', async (_event, id: number) => { setPublicationStatus(id, 'draft', '准备重新发布', { error: null }); const row = await executePublication(id); mainWindow?.webContents.send('publications:updated', id); return row })
ipcMain.handle('publish:complete', (_event, id: number) => setPublicationStatus(id, 'published', '用户已确认在官方平台完成发布', { publishedAt: new Date().toISOString(), error: null }))
ipcMain.handle('publish:fail', (_event, id: number) => setPublicationStatus(id, 'failed', '用户标记发布未完成', { error: '官方平台发布未完成，请检查登录状态或平台提示' }))
ipcMain.handle('publish:copy', (_event, id: number) => { const row = getPublication(id); if (!row) throw new Error('发布内容不存在'); return createPublications({ accountIds: [row.account_id], projectId: row.project_id, title: `${row.title}（副本）`, body: row.body, topics: row.topics, status: 'draft', workKeys: row.work_keys.split(',').filter(Boolean) })[0] })
ipcMain.handle('publish:delete', (_event, id: number) => { deletePublication(id); return true })
ipcMain.handle('chat:select-attachments', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: '文本素材', extensions: ['txt', 'md', 'json', 'csv', 'log'] }] })
  if (result.canceled) return []
  return result.filePaths.map((path) => {
    if (statSync(path).size > 1024 * 1024) throw new Error(`${basename(path)} 超过 1MB，请选择较小的文本文件`)
    return { name: basename(path), content: readFileSync(path, 'utf8') }
  })
})
ipcMain.handle('chat:start', (_event, requestId: string, conversationId: number, prompt: string, provider: string) => {
  const config = resolveTextConfig(provider)
  const userMessage = addMessage(conversationId, 'user', prompt)
  const assistantMessage = addMessage(conversationId, 'assistant', '', 'streaming')
  touchConversation(conversationId, config.provider, config.text_model)
  const controller = new AbortController()
  chatControllers.set(requestId, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeout_seconds * 1000)
  setTimeout(() => {
    let output = ''
    void streamModelReply(config, listMessages(conversationId), controller, {
      onDelta: (delta) => { output += delta; mainWindow?.webContents.send('chat:delta', { requestId, messageId: assistantMessage.id, delta }) },
      onDone: () => undefined,
      onError: (message) => { throw new Error(message) }
    }).then(() => {
      updateMessage(assistantMessage.id, output, 'completed')
      mainWindow?.webContents.send('chat:done', { requestId, messageId: assistantMessage.id, content: output, status: 'completed' })
    }).catch((error) => {
      const cancelled = cancelledChats.has(requestId)
      const message = cancelled ? '已停止生成' : controller.signal.aborted ? '模型响应超时' : error instanceof Error ? error.message : '生成失败'
      updateMessage(assistantMessage.id, output, cancelled ? 'cancelled' : 'failed', message)
      mainWindow?.webContents.send(cancelled ? 'chat:done' : 'chat:error', { requestId, messageId: assistantMessage.id, content: output, status: cancelled ? 'cancelled' : 'failed', error: message })
    }).finally(() => { clearTimeout(timeout); chatControllers.delete(requestId); cancelledChats.delete(requestId) })
  }, 0)
  return { userMessage, assistantMessage }
})
ipcMain.handle('chat:stop', (_event, requestId: string) => { cancelledChats.add(requestId); chatControllers.get(requestId)?.abort(); return true })
ipcMain.handle('agent:runs', (_event, conversationId: number) => listAgentRuns(Number(conversationId)))
ipcMain.handle('agent:start', (event, requestId: string, conversationId: number, prompt: string, provider: string, permissionMode: AgentPermissionMode) => {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) throw new Error('Agent 请求编号无效')
  if (!Number.isInteger(conversationId) || conversationId < 1) throw new Error('对话编号无效')
  if (!prompt.trim() || prompt.length > 100_000) throw new Error('请输入有效的任务内容')
  if (!['ask', 'smart', 'full'].includes(permissionMode)) throw new Error('Agent 权限等级无效')
  if (agentSessions.has(requestId)) throw new Error('该 Agent 请求正在运行')
  const config = resolveTextConfig(provider)
  const previousMessages = listMessages(conversationId).slice(-10)
  const userMessage = addMessage(conversationId, 'user', prompt)
  const assistantMessage = addMessage(conversationId, 'assistant', '', 'streaming')
  const run = createAgentRun(requestId, conversationId, config.provider, config.text_model)
  touchConversation(conversationId, config.provider, config.text_model)
  const sender = event.sender
  const send = (channel: string, payload: unknown) => { if (!sender.isDestroyed()) sender.send(channel, payload) }
  setTimeout(() => {
    let output = ''
    let session: AgentSession | undefined
    const context = previousMessages.length
      ? `以下是当前对话最近的上下文，仅用于理解用户指代：\n${previousMessages.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`).join('\n')}\n\n用户当前任务：${prompt}`
      : prompt
    void createRainbowAgent(config, { requestId, permissionMode, cwd: process.cwd(), approve: (request) => requestAgentApproval(sender, request) }, (agentEvent) => {
      if (agentEvent.type === 'delta') { output += agentEvent.delta; send('agent:delta', { requestId, messageId: assistantMessage.id, delta: agentEvent.delta }) }
      if (agentEvent.type === 'tool_start') {
        const step = startAgentStep(run.id, agentEvent.toolCallId, agentEvent.toolName, agentEvent.label, agentEvent.risk, agentEvent.input)
        send('agent:tool', { requestId, runId: run.id, step })
      }
      if (agentEvent.type === 'tool_end') {
        const step = finishAgentStep(run.id, agentEvent.toolCallId, agentEvent.output, agentEvent.isError)
        send('agent:tool', { requestId, runId: run.id, step })
      }
    }).then((created) => {
      session = created
      agentSessions.set(requestId, created)
      if (cancelledAgents.has(requestId)) return created.abort()
      return created.prompt(context, { expandPromptTemplates: false })
    }).then(() => {
      if (cancelledAgents.has(requestId)) {
        updateMessage(assistantMessage.id, output, 'cancelled', '已停止 Agent 执行')
        finishAgentRun(run.id, 'cancelled', output, '已停止 Agent 执行')
        send('agent:done', { requestId, messageId: assistantMessage.id, content: output, status: 'cancelled' })
        return
      }
      const finalText = session?.getLastAssistantText() ?? output
      updateMessage(assistantMessage.id, finalText, 'completed')
      finishAgentRun(run.id, 'completed', finalText)
      send('agent:done', { requestId, messageId: assistantMessage.id, content: finalText, status: 'completed' })
    }).catch((error) => {
      const cancelled = cancelledAgents.has(requestId)
      const message = cancelled ? '已停止 Agent 执行' : error instanceof Error ? error.message : 'Agent 执行失败'
      updateMessage(assistantMessage.id, output, cancelled ? 'cancelled' : 'failed', message)
      finishAgentRun(run.id, cancelled ? 'cancelled' : 'failed', output, message)
      send(cancelled ? 'agent:done' : 'agent:error', { requestId, messageId: assistantMessage.id, content: output, status: cancelled ? 'cancelled' : 'failed', error: message })
    }).finally(() => { session?.dispose(); cancelAgentApprovals(requestId); agentSessions.delete(requestId); cancelledAgents.delete(requestId) })
  }, 0)
  return { userMessage, assistantMessage, run: { ...run, steps: [] } }
})
ipcMain.handle('agent:approval:respond', (event, approvalId: string, decision: AgentApprovalDecision) => {
  const pending = pendingAgentApprovals.get(approvalId)
  if (!pending || pending.senderId !== event.sender.id || !['allow_once', 'allow_session', 'deny'].includes(decision)) return false
  clearTimeout(pending.timer); pendingAgentApprovals.delete(approvalId); pending.resolve(decision); return true
})
ipcMain.handle('agent:stop', async (_event, requestId: string) => { cancelledAgents.add(requestId); cancelAgentApprovals(requestId); await agentSessions.get(requestId)?.abort(); return true })
ipcMain.handle('image:providers', () => listImageProviderConfigs())
ipcMain.handle('image:select-reference', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '参考图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
  if (result.canceled) return null
  const path = result.filePaths[0]
  if (statSync(path).size > 15 * 1024 * 1024) throw new Error('参考图片不能超过 15MB')
  const extension = path.toLowerCase().split('.').pop()
  const mimeType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png'
  return { path, name: basename(path), data_url: `data:${mimeType};base64,${readFileSync(path).toString('base64')}` }
})
ipcMain.handle('image:generate', async (_event, requestId: string, provider: string, input: ImageGenerationInput) => {
  const config = resolveImageConfig(provider)
  const controller = new AbortController()
  imageControllers.set(requestId, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeout_seconds * 1000)
  try { return await generateImages(config, input, controller) }
  catch (error) { if (controller.signal.aborted) throw new Error('图片生成已停止或响应超时'); throw error }
  finally { clearTimeout(timeout); imageControllers.delete(requestId) }
})
ipcMain.handle('image:stop', (_event, requestId: string) => { imageControllers.get(requestId)?.abort(); return true })
ipcMain.handle('image:works', () => listImageWorks().map((work) => { try { return { ...work, data_url: `data:${work.mime_type};base64,${readFileSync(work.file_path).toString('base64')}` } } catch { return { ...work, data_url: '' } } }))
ipcMain.handle('image:download', async (_event, id: number) => {
  const work = getImageWork(id)
  if (!work) throw new Error('图片作品不存在')
  const result = await dialog.showSaveDialog({ defaultPath: basename(work.file_path), filters: [{ name: '图片', extensions: [work.mime_type.includes('jpeg') ? 'jpg' : work.mime_type.includes('webp') ? 'webp' : 'png'] }] })
  if (result.canceled || !result.filePath) return false
  copyFileSync(work.file_path, result.filePath)
  return true
})

app.whenReady().then(() => { openDatabase(app); createWindow(); startScheduler(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('before-quit', () => { if (scheduler) clearInterval(scheduler); for (const controller of chatControllers.values()) controller.abort(); for (const controller of imageControllers.values()) controller.abort() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
