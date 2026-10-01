import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { saveVideoWork } from './database'
import { getStorageRoot } from './storageService'
import { ffmpegPath, probeVideo } from './videoService'

const execFileAsync = promisify(execFile)
export type PolishVideoInput = { sourcePath: string; title?: string; subtitleText?: string; burnSubtitles: boolean; subtitleSize: number; subtitleColor: string; subtitlePosition: 'bottom' | 'center' | 'top'; musicPath?: string; sourceVolume: number; musicVolume: number; ratio: '9:16' | '16:9' | '1:1'; quality: '720p' | '1080p'; trimStart: number; trimEnd: number; projectId?: number }
export type PolishProgress = (progress: number, message: string) => void

export async function polishVideo(input: PolishVideoInput, signal: AbortSignal, onProgress: PolishProgress) {
  if (!input.sourcePath || !existsSync(input.sourcePath)) throw new Error('请选择需要润色的成片')
  if (input.musicPath && !existsSync(input.musicPath)) throw new Error('选择的背景音乐文件不存在')
  const meta = await probeVideo(input.sourcePath); const sourceDuration = meta.duration || 0
  const start = Math.max(0, Number(input.trimStart) || 0); const endTrim = Math.max(0, Number(input.trimEnd) || 0)
  const duration = sourceDuration ? Math.max(.5, sourceDuration - start - endTrim) : 0
  if (sourceDuration && start + endTrim >= sourceDuration) throw new Error('开头和结尾裁剪时长不能超过视频总时长')
  const directory = join(getStorageRoot(app), 'works', 'videos'); const subtitleDirectory = join(getStorageRoot(app), 'works', 'subtitles'); mkdirSync(directory, { recursive: true }); mkdirSync(subtitleDirectory, { recursive: true })
  const key = `polished-${Date.now()}`; const filePath = join(directory, `${key}.mp4`); let subtitlePath = ''
  const subtitleText = input.subtitleText?.trim() || ''
  if (subtitleText) { subtitlePath = join(subtitleDirectory, `${key}.srt`); writeFileSync(subtitlePath, createSrt(subtitleText, duration || Math.max(5, subtitleText.length / 4)), 'utf8') }
  onProgress(5, '正在分析成片音视频轨道')
  const sourceHasAudio = await hasAudio(input.sourcePath); const dimensions = outputDimensions(input.ratio, input.quality)
  const args: string[] = ['-y']; if (start > 0) args.push('-ss', start.toFixed(3)); args.push('-i', input.sourcePath); if (input.musicPath) args.push('-stream_loop', '-1', '-i', input.musicPath); if (duration) args.push('-t', duration.toFixed(3))
  const videoFilters = [`scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease`, `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1']
  if (input.burnSubtitles && subtitlePath) videoFilters.push(subtitleFilter(subtitlePath, input.subtitleSize, input.subtitleColor, input.subtitlePosition, dimensions.height))
  args.push('-vf', videoFilters.join(','), '-map', '0:v:0')
  if (input.musicPath && sourceHasAudio) { args.push('-filter_complex', `[0:a]volume=${volume(input.sourceVolume)}[voice];[1:a]volume=${volume(input.musicVolume)},afade=t=in:st=0:d=1[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`, '-map', '[aout]') }
  else if (input.musicPath) args.push('-filter_complex', `[1:a]volume=${volume(input.musicVolume)},afade=t=in:st=0:d=1[aout]`, '-map', '[aout]')
  else if (sourceHasAudio) args.push('-map', '0:a:0', '-filter:a', `volume=${volume(input.sourceVolume)}`)
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', input.quality === '1080p' ? '19' : '21', '-pix_fmt', 'yuv420p')
  if (input.musicPath || sourceHasAudio) args.push('-c:a', 'aac', '-b:a', '192k'); args.push('-movflags', '+faststart', '-shortest', filePath)
  try {
    await runFfmpeg(args, duration || sourceDuration || 30, signal, onProgress)
    const title = input.title?.trim() || `${basename(input.sourcePath).replace(/\.[^.]+$/, '')}-润色成片`
    const row = saveVideoWork({ title, prompt: subtitleText, provider: '本地润色', model: 'FFmpeg 成片渲染', ratio: input.ratio, resolution: input.quality, duration: Math.max(1, Math.round(duration || sourceDuration || 1)), file_path: filePath, mime_type: 'video/mp4', video_project_id: input.projectId ?? null, source_image_path: input.sourcePath })
    onProgress(100, '润色成片已保存到“我的作品”')
    return { id: row.id, title: row.title, filePath, dataUrl: pathToFileURL(filePath).href, subtitlePath, provider: row.provider, model: row.model, ratio: row.ratio, resolution: row.resolution, duration: row.duration }
  } catch (error) { if (existsSync(filePath)) unlinkSync(filePath); throw error }
}

async function hasAudio(path: string) { try { const result = await execFileAsync(ffmpegPath('ffprobe'), ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path], { windowsHide: true }); return result.stdout.trim() === 'audio' } catch { return false } }
function volume(value: number) { return Math.max(0, Math.min(2, Number(value) / 100 || 0)).toFixed(2) }
function outputDimensions(ratio: PolishVideoInput['ratio'], quality: PolishVideoInput['quality']) { const long = quality === '1080p' ? 1920 : 1280; const short = quality === '1080p' ? 1080 : 720; return ratio === '9:16' ? { width: short, height: long } : ratio === '1:1' ? { width: short, height: short } : { width: long, height: short } }
function subtitleFilter(path: string, size: number, color: string, position: PolishVideoInput['subtitlePosition'], height: number) { const escaped = path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"); const alignment = position === 'top' ? 8 : position === 'center' ? 5 : 2; const margin = position === 'bottom' ? Math.round(height * .06) : 24; return `subtitles='${escaped}':force_style='FontName=Microsoft YaHei,FontSize=${Math.max(14, Math.min(48, size || 26))},PrimaryColour=${assColor(color)},OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=${alignment},MarginV=${margin}'` }
function assColor(value: string) { const hex = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : 'FFFFFF'; return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}` }
function createSrt(text: string, duration: number) { const chunks = splitSubtitle(text); const weights = chunks.map((item) => Math.max(2, item.length)); const total = weights.reduce((sum, value) => sum + value, 0); let cursor = 0; return chunks.map((item, index) => { const start = cursor; const length = index === chunks.length - 1 ? duration - cursor : duration * weights[index] / total; cursor = Math.min(duration, cursor + Math.max(.05, length)); return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${item}\n` }).join('\n') }
function splitSubtitle(text: string) { const sentences = text.replace(/\s+/g, ' ').split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean); const result: string[] = []; for (const sentence of sentences.length ? sentences : [text]) { if (sentence.length <= 22) result.push(sentence); else for (let index = 0; index < sentence.length; index += 20) result.push(sentence.slice(index, index + 20)) } return result.length ? result : [''] }
function srtTime(seconds: number) { const ms = Math.max(0, Math.round(seconds * 1000)); const hours = Math.floor(ms / 3_600_000); const minutes = Math.floor(ms % 3_600_000 / 60_000); const secs = Math.floor(ms % 60_000 / 1000); const millis = ms % 1000; return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}` }
function runFfmpeg(args: string[], duration: number, signal: AbortSignal, onProgress: PolishProgress) { return new Promise<void>((resolve, reject) => { const child = spawn(ffmpegPath('ffmpeg'), args, { windowsHide: true }); let stderr = ''; const abort = () => child.kill(); signal.addEventListener('abort', abort, { once: true }); child.stderr.on('data', (chunk) => { const text = String(chunk); stderr = `${stderr}${text}`.slice(-6000); const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/); if (match) { const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]); onProgress(Math.min(96, 10 + Math.round(seconds / duration * 86)), '正在渲染字幕、画面和音频') } }); const events = child as unknown as { on: (event: string, handler: (...args: any[]) => void) => void }; events.on('error', (error: Error) => { signal.removeEventListener('abort', abort); reject(error) }); events.on('close', (code: number | null) => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(new Error('已停止本地成片渲染')); else if (code === 0) resolve(); else reject(new Error(`成片渲染失败：${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `FFmpeg 退出码 ${code}`}`)) }) }) }
