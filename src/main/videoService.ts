import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { getStorageRoot } from './storageService'
import { loadApiKey, resolveAsrConfig } from './modelConfig'
import { findPlatformAuthorization } from './publishService'

const execFileAsync = promisify(execFile)
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
const MODEL_BYTES = 488_000_000

function dataRoot() { const root = join(getStorageRoot(app), 'video-studio'); mkdirSync(root, { recursive: true }); return root }
export function whisperModelPath() { return join(dataRoot(), 'models', 'ggml-small.bin') }
function ytDlpPath() { return join(dataRoot(), 'tools', 'yt-dlp.exe') }
function findFile(root: string, name: string): string {
  if (!existsSync(root)) return ''
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    if (item.isFile() && item.name.toLowerCase() === name.toLowerCase()) return path
    if (item.isDirectory()) { const nested = findFile(path, name); if (nested) return nested }
  }
  return ''
}
export function whisperCliPath() {
  const candidates = [findFile(join(dataRoot(), 'tools'), 'whisper-cli.exe'), join(process.resourcesPath, 'whisper', 'whisper-cli.exe')]
  return candidates.find(existsSync) ?? ''
}
export function ffmpegPath(kind: 'ffmpeg' | 'ffprobe') {
  const executable = `${kind}.exe`
  const candidates = [join(process.resourcesPath, 'ffmpeg', 'bin', executable), join(app.getAppPath(), '..', 'liying_ai-main', 'ffmpeg', 'bin', executable), join(app.getAppPath(), '..', '..', 'liying_ai-main', 'ffmpeg', 'bin', executable)]
  return candidates.find(existsSync) ?? kind
}

export function getWhisperStatus() {
  const modelPath = whisperModelPath(); const cliPath = whisperCliPath()
  return { model: 'Whisper small', modelReady: existsSync(modelPath), engineReady: Boolean(cliPath), ready: existsSync(modelPath) && Boolean(cliPath), modelPath, cliPath, expectedBytes: MODEL_BYTES }
}

export async function downloadWhisperSmall(onProgress: (progress: number, received: number, total: number) => void) {
  const target = whisperModelPath(); const temporary = `${target}.download`; mkdirSync(dirname(target), { recursive: true })
  if (existsSync(target) && statSync(target).size > 400_000_000) return getWhisperStatus()
  if (existsSync(temporary)) unlinkSync(temporary)
  const response = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）`)
  const total = Number(response.headers.get('content-length')) || MODEL_BYTES
  const writer = createWriteStream(temporary); const reader = response.body.getReader(); let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      received += value.byteLength
      if (!writer.write(Buffer.from(value))) await new Promise<void>((resolve, reject) => { writer.once('drain', resolve); writer.once('error', reject) })
      onProgress(Math.min(100, Math.round(received / total * 100)), received, total)
    }
    await new Promise<void>((resolve, reject) => { writer.end(resolve); writer.once('error', reject) })
    renameSync(temporary, target); return getWhisperStatus()
  } catch (error) { writer.destroy(); if (existsSync(temporary)) unlinkSync(temporary); throw error }
}

type GitHubRelease = { tag_name: string; assets: Array<{ name: string; browser_download_url: string; size: number }> }
export async function installWhisperEngine(onProgress: (progress: number, received: number, total: number, phase: 'downloading' | 'extracting') => void) {
  const response = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Rainbow-AI' } })
  if (!response.ok) throw new Error(`无法获取 Whisper 官方版本（HTTP ${response.status}）`)
  const releases = await response.json() as GitHubRelease[]
  const release = releases.find((item) => item.assets.some((asset) => asset.name === 'whisper-bin-x64.zip'))
  const asset = release?.assets.find((item) => item.name === 'whisper-bin-x64.zip')
  if (!release || !asset) throw new Error('官方发布中未找到 Windows x64 执行引擎')
  const downloads = join(dataRoot(), 'downloads'); const tools = join(dataRoot(), 'tools', release.tag_name); mkdirSync(downloads, { recursive: true }); mkdirSync(tools, { recursive: true })
  const archive = join(downloads, `${release.tag_name}-whisper-bin-x64.zip.download`)
  if (existsSync(archive)) unlinkSync(archive)
  const extract = async (received: number, total: number) => {
    onProgress(100, received, total, 'extracting')
    await execFileAsync('tar.exe', ['-xf', archive, '-C', tools], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const cli = findFile(tools, 'whisper-cli.exe'); if (!cli) throw new Error('执行引擎解压完成，但未找到 whisper-cli.exe')
    unlinkSync(archive); return { ...getWhisperStatus(), release: release.tag_name }
  }
  let activeWriter: ReturnType<typeof createWriteStream> | null = null
  try {
    const assetResponse = await fetch(asset.browser_download_url, { redirect: 'follow', headers: { 'User-Agent': 'Rainbow-AI' } })
    if (!assetResponse.ok || !assetResponse.body) throw new Error(`执行引擎下载失败（HTTP ${assetResponse.status}）`)
    const total = Number(assetResponse.headers.get('content-length')) || asset.size; const writer = createWriteStream(archive); activeWriter = writer; const reader = assetResponse.body.getReader(); let received = 0
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      received += value.byteLength
      if (!writer.write(Buffer.from(value))) await new Promise<void>((resolve, reject) => { writer.once('drain', resolve); writer.once('error', reject) })
      onProgress(Math.min(100, Math.round(received / total * 100)), received, total, 'downloading')
    }
    await new Promise<void>((resolve, reject) => { writer.end(resolve); writer.once('error', reject) })
    activeWriter = null
    return extract(received, total)
  } catch (firstError) {
    activeWriter?.destroy(); activeWriter = null
    if (existsSync(archive)) unlinkSync(archive)
    try {
      onProgress(5, 0, asset.size, 'downloading')
      await execFileAsync('curl.exe', ['-L', '--fail', '--retry', '3', '--retry-delay', '2', '--output', archive, asset.browser_download_url], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
      const received = statSync(archive).size; onProgress(100, received, received, 'downloading'); return extract(received, received)
    } catch { if (existsSync(archive)) unlinkSync(archive); throw firstError }
  }
}

export function detectVideoPlatform(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host.includes('douyin.com')) return '抖音'
    if (host.includes('bilibili.com') || host === 'b23.tv') return 'B站'
    if (host.includes('xiaohongshu.com') || host === 'xhslink.com') return '小红书'
    if (host.includes('kuaishou.com')) return '快手'
    if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube'
    return host.replace(/^www\./, '')
  } catch { return '' }
}

export function extractVideoUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s<>"']+/i)
  return match?.[0].replace(/[，。！？；、）)\]}]+$/, '') ?? ''
}

export async function ensureVideoDownloader(onProgress: (progress: number, message: string) => void) {
  const target = ytDlpPath(); if (existsSync(target)) return target
  mkdirSync(dirname(target), { recursive: true }); const temporary = `${target}.download`; if (existsSync(temporary)) unlinkSync(temporary)
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  try {
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Rainbow-AI' } }); if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 18_000_000; const writer = createWriteStream(temporary); const reader = response.body.getReader(); let received = 0
    while (true) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; if (!writer.write(Buffer.from(value))) await new Promise<void>((resolve) => writer.once('drain', resolve)); onProgress(Math.min(100, Math.round(received / total * 100)), '正在安装链接解析器') }
    await new Promise<void>((resolve, reject) => { writer.end(resolve); writer.once('error', reject) })
  } catch {
    if (existsSync(temporary)) unlinkSync(temporary); await execFileAsync('curl.exe', ['-L', '--fail', '--retry', '3', '--output', temporary, url], { windowsHide: true }); onProgress(100, '链接解析器安装完成')
  }
  renameSync(temporary, target); return target
}

export async function transcribeOnlineVideo(url: string, language: string, signal: AbortSignal, onProgress: (progress: number, message: string) => void, engine: 'local' | 'api' = 'local', provider?: string) {
  const downloader = await ensureVideoDownloader(onProgress); if (signal.aborted) throw new Error('已停止解析')
  const onlineRoot = join(dataRoot(), 'online'); mkdirSync(onlineRoot, { recursive: true }); const workDir = join(onlineRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}`); mkdirSync(workDir, { recursive: true })
  const template = join(workDir, 'source.%(ext)s'); let errorOutput = ''
  try {
    onProgress(0, '正在获取在线视频')
    const auth = findPlatformAuthorization(detectVideoPlatform(url)); const authArgs: string[] = []
    if (auth?.method === 'browser') authArgs.push('--cookies-from-browser', auth.browser)
    if (auth?.method === 'cookies') { const cookiePath = join(workDir, 'cookies.txt'); writeFileSync(cookiePath, auth.cookies, 'utf8'); authArgs.push('--cookies', cookiePath) }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(downloader, ['--no-playlist', '--newline', '--no-warnings', '--progress-template', 'download:%(progress._percent_str)s', '--ffmpeg-location', dirname(ffmpegPath('ffmpeg')), ...authArgs, '-f', 'bestaudio/best', '-o', template, url], { windowsHide: true })
      const abort = () => { child.kill(); reject(new Error('已停止解析')) }; signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk) => { const text = String(chunk); const match = text.match(/download:\s*([\d.]+)%/); if (match) onProgress(Math.round(Number(match[1])), '正在下载视频音频') })
      child.stderr.on('data', (chunk) => { errorOutput += String(chunk) })
      ;(child as unknown as { on: (event: string, handler: (...args: any[]) => void) => void }).on('error', reject)
      ;(child as unknown as { on: (event: string, handler: (...args: any[]) => void) => void }).on('close', (code: number | null) => { signal.removeEventListener('abort', abort); if (code === 0) resolve(); else reject(new Error(errorOutput.trim().slice(-500) || `链接解析器退出（${code}）`)) })
    })
    const media = readdirSync(workDir).map((name) => join(workDir, name)).find((path) => basename(path).startsWith('source.') && !path.endsWith('.part') && statSync(path).isFile())
    if (!media) throw new Error('没有从链接中取得可转写的音频')
    onProgress(100, engine === 'api' ? '正在上传音轨到 ASR API' : '正在使用 Whisper 转写')
    return engine === 'api' ? await transcribeApiMedia(media, language, provider || '', signal) : await transcribeLocalVideo(media, language, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : '在线视频解析失败'
    if (/Unsupported URL/i.test(message)) throw new Error('当前平台链接暂不受支持，请改用本地视频')
    if (/cookies|login|Sign in|fresh cookies|DPAPI|Could not copy/i.test(message)) throw new Error('平台登录状态不可用，请在“内容发布 → 渠道账号”重新授权；浏览器 Cookie 被占用时请关闭对应浏览器后重试，也可以改用本地视频')
    throw error
  } finally { const resolved = join(onlineRoot, basename(workDir)); if (resolved.startsWith(onlineRoot) && existsSync(resolved)) rmSync(resolved, { recursive: true, force: true }) }
}

export async function probeVideo(path: string) {
  if (!existsSync(path)) throw new Error('选择的视频文件不存在')
  let duration: number | null = null
  try {
    const result = await execFileAsync(ffmpegPath('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { windowsHide: true })
    const parsed = Number(result.stdout.trim()); if (Number.isFinite(parsed)) duration = parsed
  } catch { /* 文件仍可保存，稍后安装 FFmpeg 后再次解析。 */ }
  return { displayName: basename(path), fileSize: statSync(path).size, duration }
}

export async function transcribeLocalVideo(path: string, language = 'zh', signal?: AbortSignal) {
  const status = getWhisperStatus()
  if (!status.modelReady) throw new Error('请先下载 Whisper small 模型')
  if (!status.engineReady) throw new Error('Whisper 执行引擎尚未安装，请先点击自动安装')
  const workDir = join(dataRoot(), 'transcripts'); mkdirSync(workDir, { recursive: true })
  const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`; const wavPath = join(workDir, `${key}.wav`); const outputBase = join(workDir, key)
  try {
    await execFileAsync(ffmpegPath('ffmpeg'), ['-y', '-i', path, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal })
    await execFileAsync(status.cliPath, ['-m', status.modelPath, '-f', wavPath, '-l', language === 'auto' ? 'auto' : language, '-otxt', '-of', outputBase], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, signal })
    const { readFileSync } = await import('node:fs'); return readFileSync(`${outputBase}.txt`, 'utf8').trim()
  } finally {
    for (const file of [wavPath, `${outputBase}.txt`]) if (existsSync(file)) unlinkSync(file)
  }
}

export async function transcribeApiMedia(path: string, language: string, provider: string, signal?: AbortSignal) {
  if (!existsSync(path)) throw new Error('需要转写的媒体文件不存在')
  const config = resolveAsrConfig(provider)
  const apiKey = loadApiKey(config.provider)
  const workDir = join(dataRoot(), 'transcripts'); mkdirSync(workDir, { recursive: true })
  const audioPath = join(workDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`)
  try {
    await execFileAsync(ffmpegPath('ffmpeg'), ['-y', '-i', path, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', audioPath], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal })
    const bytes = statSync(audioPath).size
    if (!bytes) throw new Error('没有从视频中提取到可识别的音频')
    if (bytes > 25 * 1024 * 1024) throw new Error('提取后的音频超过 25MB，请缩短视频后重试或改用本地 Whisper')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(readFileSync(audioPath))], { type: 'audio/mpeg' }), basename(audioPath))
    form.append('model', config.asr_model)
    form.append('response_format', 'json')
    if (language && language !== 'auto') form.append('language', language)
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (config.provider === '小米 MiMo' || /xiaomimimo\.com/i.test(config.base_url)) headers['api-key'] = apiKey
    const response = await fetch(`${config.base_url.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers, body: form, signal })
    const raw = await response.text()
    if (!response.ok) {
      let detail = raw
      try { const body = JSON.parse(raw); detail = body.error?.message || body.message || raw } catch {}
      throw new Error(response.status === 401 ? 'ASR API Key 无效或没有权限' : `ASR 请求失败（${response.status}）：${String(detail).slice(0, 240)}`)
    }
    let content = raw
    try { const body = JSON.parse(raw); content = body.text || body.data?.text || '' } catch {}
    if (!content.trim()) throw new Error('ASR 服务未返回转写文字')
    return content.trim()
  } finally { if (existsSync(audioPath)) unlinkSync(audioPath) }
}
