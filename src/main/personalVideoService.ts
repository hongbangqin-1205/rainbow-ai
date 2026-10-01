import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getAudioWork, saveVideoWork } from './database'
import { getStorageRoot } from './storageService'
import { ffmpegPath, probeVideo } from './videoService'

export type PersonalVideoInput = { videoPath: string; audioWorkId: number; projectId?: number; title?: string }
export type PersonalVideoProgress = (progress: number, message: string) => void

export async function composePersonalVideo(input: PersonalVideoInput, signal: AbortSignal, onProgress: PersonalVideoProgress) {
  if (!input.videoPath || !existsSync(input.videoPath)) throw new Error('请先选择本地人物视频')
  const audio = getAudioWork(input.audioWorkId); if (!audio || !existsSync(audio.file_path)) throw new Error('选择的旁白文件不存在，请重新生成或选择旁白')
  const directory = join(getStorageRoot(app), 'works', 'videos'); mkdirSync(directory, { recursive: true })
  const filePath = join(directory, `personal-video-${Date.now()}.mp4`)
  onProgress(8, '正在检查人物视频和旁白')
  const [videoMeta, audioMeta] = await Promise.all([probeVideo(input.videoPath), probeVideo(audio.file_path)])
  onProgress(20, '正在合并人物画面与旁白')
  try {
    await runFfmpeg(['-y', '-stream_loop', '-1', '-i', input.videoPath, '-i', audio.file_path, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', filePath], signal, (progress) => onProgress(progress, '正在渲染音画合成视频'))
    const duration = Math.max(1, Math.round(audioMeta.duration || videoMeta.duration || 1))
    const title = input.title?.trim() || `${basename(input.videoPath).replace(/\.[^.]+$/, '')}-旁白成片`
    const row = saveVideoWork({ title, prompt: audio.prompt, provider: '本地合成', model: 'FFmpeg 音画合成', ratio: '原视频', resolution: '原画质', duration, file_path: filePath, mime_type: 'video/mp4', video_project_id: input.projectId ?? null, source_image_path: input.videoPath })
    onProgress(100, '成片已保存到“我的作品”')
    return { id: row.id, title: row.title, filePath, dataUrl: pathToFileURL(filePath).href, provider: row.provider, model: row.model, ratio: row.ratio, resolution: row.resolution, duration: row.duration }
  } catch (error) { if (existsSync(filePath)) unlinkSync(filePath); throw error }
}

function runFfmpeg(args: string[], signal: AbortSignal, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath('ffmpeg'), args, { windowsHide: true }); let stderr = ''; let ticks = 0
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-5000); ticks += 1; onProgress(Math.min(92, 25 + ticks)) })
    const processEvents = child as unknown as { on: (event: string, handler: (...args: any[]) => void) => void }
    processEvents.on('error', (error: Error) => { signal.removeEventListener('abort', abort); reject(error) })
    processEvents.on('close', (code: number | null) => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(new Error('已停止本地音画合成')); else if (code === 0) resolve(); else reject(new Error(`音画合成失败：${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `FFmpeg 退出码 ${code}`}`)) })
  })
}
