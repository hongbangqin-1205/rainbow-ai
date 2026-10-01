import { useEffect, useRef, useState } from 'react'
import { AppDialog, useAppDialog } from './AppDialog'
import { readAsrEngine } from './asrPreferences'

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="video-field"><span>{label}</span>{children}</label>
const StepCard = ({ number, title, hint, className = '', children }: { number: string; title: string; hint: string; className?: string; children: React.ReactNode }) => <section className={`video-step-card ${className}`}><header><b>{number}</b><div><h2>{title}</h2><small>{hint}</small></div><i>↗</i></header><div className="video-step-body">{children}</div></section>
type SourceTab = 'url' | 'file' | 'text'

function formatBytes(value: number | null) { if (!value) return ''; return value > 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB` }
function formatDuration(value: number | null) { if (!value) return ''; const minutes = Math.floor(value / 60); return `${minutes}:${Math.round(value % 60).toString().padStart(2, '0')}` }
function friendlyError(error: unknown, fallback: string) { const message = error instanceof Error ? error.message : fallback; return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') }
async function recordingToWav(blob: Blob) {
  const context = new AudioContext(); const decoded = await context.decodeAudioData(await blob.arrayBuffer()); await context.close()
  const frames = decoded.length; const channels = decoded.numberOfChannels; const bytes = new ArrayBuffer(44 + frames * 2); const view = new DataView(bytes)
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, decoded.sampleRate, true); view.setUint32(28, decoded.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true)
  const channelData = Array.from({ length: channels }, (_, index) => decoded.getChannelData(index)); let offset = 44
  for (let frame = 0; frame < frames; frame += 1) { let value = 0; for (const channel of channelData) value += channel[frame] / channels; value = Math.max(-1, Math.min(1, value)); view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true); offset += 2 }
  return new Uint8Array(bytes)
}

export function WorkspacePage({ onPublish }: { onPublish: (draft: PublishDraft) => void }) {
  const appDialog = useAppDialog()
  const initialized = useRef(false)
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [project, setProject] = useState<VideoProject | null>(null)
  const [sources, setSources] = useState<VideoSource[]>([])
  const [title, setTitle] = useState('未命名视频项目')
  const [mode, setMode] = useState<'breakdown' | 'inspiration' | 'original'>('inspiration')
  const [language, setLanguage] = useState('zh')
  const [targetLength, setTargetLength] = useState(100)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('已自动保存')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sourceTab, setSourceTab] = useState<SourceTab>('url')
  const [sourceValue, setSourceValue] = useState('')
  const [busy, setBusy] = useState<number | 'add' | null>(null)
  const [notice, setNotice] = useState('')
  const [asrEngine] = useState(readAsrEngine)
  const [asrProviders, setAsrProviders] = useState<AsrProviderConfig[]>([])
  const [asrProvider, setAsrProvider] = useState(() => localStorage.getItem('rainbow-asr-provider') || '')
  const [generations, setGenerations] = useState<VideoGeneration[]>([])
  const [subject, setSubject] = useState('')
  const [product, setProduct] = useState('')
  const [audience, setAudience] = useState('普通用户')
  const [platform, setPlatform] = useState('抖音')
  const [style, setStyle] = useState('自然、有吸引力')
  const [rewriteStrength, setRewriteStrength] = useState(70)
  const [generating, setGenerating] = useState('')
  const [sourceProgress, setSourceProgress] = useState<Record<number, { progress: number; message: string }>>({})
  const [voice, setVoice] = useState('alloy')
  const [voiceProviders, setVoiceProviders] = useState<VoiceProviderConfig[]>([])
  const [voiceProvider, setVoiceProvider] = useState('')
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([])
  const [cloneSampleId, setCloneSampleId] = useState(0)
  const [voiceCloneOpen, setVoiceCloneOpen] = useState(false)
  const [voiceCloneTab, setVoiceCloneTab] = useState<'record' | 'upload'>('record')
  const [voiceSampleName, setVoiceSampleName] = useState('我的克隆音色')
  const [voiceAuthorized, setVoiceAuthorized] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingUrl, setRecordingUrl] = useState('')
  const [voiceSampleBusy, setVoiceSampleBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingUrlRef = useRef('')
  const [speechSpeed, setSpeechSpeed] = useState(1)
  const [emotion, setEmotion] = useState('自然')
  const [audioResult, setAudioResult] = useState<{ id: number; title: string; filePath: string; dataUrl: string; provider: string; model: string; voice: string; speed: number } | null>(null)
  const [avatarImage, setAvatarImage] = useState<{ path: string; name: string; dataUrl: string } | null>(null)
  const [videoProviders, setVideoProviders] = useState<VideoProviderConfig[]>([])
  const [avatarProvider, setAvatarProvider] = useState('DMXAPI')
  const [avatarVideoModel, setAvatarVideoModel] = useState('doubao-seedance-2-0-260128')
  const [avatarRatio, setAvatarRatio] = useState('9:16')
  const [avatarResolution, setAvatarResolution] = useState('720p')
  const [avatarDuration, setAvatarDuration] = useState(5)
  const [avatarMotion, setAvatarMotion] = useState('natural')
  const [avatarProgress, setAvatarProgress] = useState(0)
  const [avatarProgressText, setAvatarProgressText] = useState('')
  const [avatarRequestId, setAvatarRequestId] = useState('')
  const [avatarResult, setAvatarResult] = useState<{ id: number; title: string; filePath: string; dataUrl: string; provider: string; model: string; ratio: string; resolution: string; duration: number } | null>(null)
  const [avatarTasks, setAvatarTasks] = useState<DigitalHumanTask[]>([])
  const [avatarConfirmOpen, setAvatarConfirmOpen] = useState(false)
  const [avatarRecoverOpen, setAvatarRecoverOpen] = useState(false)
  const [avatarUpstreamTaskId, setAvatarUpstreamTaskId] = useState('')
  const [avatarMode, setAvatarMode] = useState<'image' | 'personal'>('image')
  const [audioWorks, setAudioWorks] = useState<AudioWork[]>([])
  const [personalVideo, setPersonalVideo] = useState<{ path: string; name: string; duration: number | null; fileSize: number; dataUrl: string } | null>(null)
  const [personalAudioId, setPersonalAudioId] = useState(0)
  const [personalProgress, setPersonalProgress] = useState(0)
  const [personalProgressText, setPersonalProgressText] = useState('')
  const [personalResult, setPersonalResult] = useState<DigitalHumanResult | null>(null)
  const [polishWorks, setPolishWorks] = useState<VideoWork[]>([])
  const [polishSource, setPolishSource] = useState<{ path: string; name: string; duration: number | null; dataUrl: string } | null>(null)
  const [polishMusic, setPolishMusic] = useState<{ path: string; name: string; dataUrl: string } | null>(null)
  const [burnSubtitles, setBurnSubtitles] = useState(true)
  const [subtitleSize, setSubtitleSize] = useState(26)
  const [subtitleColor, setSubtitleColor] = useState('#ffffff')
  const [subtitlePosition, setSubtitlePosition] = useState<'bottom' | 'center' | 'top'>('bottom')
  const [sourceVolume, setSourceVolume] = useState(100)
  const [musicVolume, setMusicVolume] = useState(25)
  const [polishRatio, setPolishRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16')
  const [polishQuality, setPolishQuality] = useState<'720p' | '1080p'>('1080p')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [polishProgress, setPolishProgress] = useState(0)
  const [polishProgressText, setPolishProgressText] = useState('')
  const [polishResult, setPolishResult] = useState<PolishVideoResult | null>(null)

  const loadProject = async (id: number) => {
    const [data, tasks] = await Promise.all([window.electronAPI.video.projects.load(id), window.electronAPI.video.digitalHuman.list(id)]); setProject(data.project); setSources(data.sources); setGenerations(data.generations.filter((item) => item.kind !== 'translation')); setAvatarTasks(tasks)
    const latestTranscript = data.sources.find((source) => source.transcript?.status === 'completed' && source.transcript.content)?.transcript?.content ?? ''
    setTitle(data.project.title); setMode(['breakdown', 'original'].includes(data.project.mode) ? data.project.mode as 'breakdown' | 'original' : 'inspiration'); setLanguage(data.project.language); setTargetLength(data.project.target_length); setDraft(data.project.draft || latestTranscript)
  }
  const refreshProjects = async () => { const rows = await window.electronAPI.video.projects.list(); setProjects(rows); return rows }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' }); if (initialized.current) return; initialized.current = true
    void (async () => { const rows = await refreshProjects(); const current = rows[0] ?? await window.electronAPI.video.projects.create(); await refreshProjects(); await loadProject(current.id); const [voiceRows, asrRows, sampleRows, videoRows, audioRows, existingVideos] = await Promise.all([window.electronAPI.video.voice.providers(), window.electronAPI.video.asr.providers(), window.electronAPI.video.voice.samples.list(), window.electronAPI.video.digitalHuman.providers(), window.electronAPI.video.personal.audioWorks(), window.electronAPI.video.polish.videoWorks()]); setVoiceProviders(voiceRows); setAsrProviders(asrRows); setVoiceSamples(sampleRows); setVideoProviders(videoRows); setAudioWorks(audioRows); setPolishWorks(existingVideos); if (existingVideos[0]) setPolishSource({ path: existingVideos[0].file_path, name: existingVideos[0].title, duration: existingVideos[0].duration, dataUrl: existingVideos[0].dataUrl }); if (audioRows[0]) setPersonalAudioId(audioRows[0].id); const firstVideo = videoRows.find((item) => item.configured) ?? videoRows[0]; if (firstVideo) { setAvatarProvider(firstVideo.provider); setAvatarVideoModel(firstVideo.model) }; const firstVoice = voiceRows.find((item) => item.configured && item.model); const storedAsr = localStorage.getItem('rainbow-asr-provider'); const firstAsr = asrRows.find((item) => item.provider === storedAsr) ?? asrRows.find((item) => item.configured && item.model); if (firstVoice) { setVoiceProvider(firstVoice.provider); if (/^mimo-.*-tts/i.test(firstVoice.model)) setVoice('mimo_default') }; if (firstAsr) setAsrProvider(firstAsr.provider) })()
    const offSource = window.electronAPI.video.sources.onProgress(({ sourceId, progress, message }) => setSourceProgress((current) => ({ ...current, [sourceId]: { progress, message } })))
    return offSource
  }, [])

  useEffect(() => () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); recordingStreamRef.current?.getTracks().forEach((track) => track.stop()); if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current) }, [])

  useEffect(() => window.electronAPI.video.digitalHuman.onProgress(({ requestId, progress, message }) => { if (!avatarRequestId || requestId === avatarRequestId) { setAvatarProgress(progress); setAvatarProgressText(message) } }), [avatarRequestId])
  useEffect(() => window.electronAPI.video.personal.onProgress(({ progress, message }) => { setPersonalProgress(progress); setPersonalProgressText(message) }), [])
  useEffect(() => window.electronAPI.video.polish.onProgress(({ progress, message }) => { setPolishProgress(progress); setPolishProgressText(message) }), [])

  useEffect(() => {
    if (!project) return
    setSaved('保存中…')
    const timer = window.setTimeout(async () => { await window.electronAPI.video.projects.update(project.id, { title: title.trim() || '未命名视频项目', mode, language, targetLength, draft }); setSaved(`已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`); void refreshProjects() }, 650)
    return () => window.clearTimeout(timer)
  }, [project?.id, title, mode, language, targetLength, draft])

  const reloadProjectData = async () => { if (project) { const data = await window.electronAPI.video.projects.load(project.id); setSources(data.sources); setGenerations(data.generations.filter((item) => item.kind !== 'translation')) } }
  const addSource = async () => {
    if (!project) return; setBusy('add'); setNotice('')
    try {
      if (sourceTab === 'url') await window.electronAPI.video.sources.addUrl(project.id, sourceValue)
      if (sourceTab === 'text') { await window.electronAPI.video.sources.addText(project.id, sourceValue); setDraft(sourceValue.trim()) }
      if (sourceTab === 'file') await window.electronAPI.video.sources.addFile(project.id)
      setSourceValue(''); setDialogOpen(false); await reloadProjectData()
    } catch (error) { setNotice(friendlyError(error, '添加失败')) } finally { setBusy(null) }
  }
  const transcribe = async (source: VideoSource) => {
    setBusy(source.id); setNotice('')
    if (asrEngine === 'api') { const selected = asrProviders.find((item) => item.provider === asrProvider); if (!selected?.configured || !selected.model) { setBusy(null); setNotice('请先在“API 与模型”中配置 ASR 服务商、API Key 和转写模型'); return } }
    try { const result = await window.electronAPI.video.sources.transcribe(source.id, language, asrEngine, asrProvider); if (result.content) setDraft(result.content); await reloadProjectData() }
    catch (error) { setNotice(friendlyError(error, '解析失败')); await reloadProjectData() } finally { setBusy(null); setSourceProgress((current) => { const next = { ...current }; delete next[source.id]; return next }) }
  }
  const removeSource = async (id: number) => { await window.electronAPI.video.sources.delete(id); await reloadProjectData() }
  const refreshVoiceSamples = async () => { const rows = await window.electronAPI.video.voice.samples.list(); setVoiceSamples(rows); return rows }
  const stopRecordingTracks = () => { recordingStreamRef.current?.getTracks().forEach((track) => track.stop()); recordingStreamRef.current = null }
  const startVoiceRecording = async () => {
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      recordingStreamRef.current = stream; recordingChunksRef.current = []
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined); recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data) }
      recorder.onstop = () => { const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' }); if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current); const nextUrl = URL.createObjectURL(blob); recordingUrlRef.current = nextUrl; setRecordingBlob(blob); setRecordingUrl(nextUrl); setRecording(false); stopRecordingTracks() }
      recorder.start(250); setRecording(true); setRecordingBlob(null); if (recordingUrlRef.current) { URL.revokeObjectURL(recordingUrlRef.current); recordingUrlRef.current = ''; setRecordingUrl('') }
    } catch (error) { stopRecordingTracks(); setNotice(error instanceof Error && error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在系统设置中允许 Rainbow AI 使用麦克风' : friendlyError(error, '无法开始录音')) }
  }
  const stopVoiceRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }
  const saveVoiceRecording = async () => {
    if (!recordingBlob) { setNotice('请先录制一段声音样本'); return }; if (!voiceAuthorized) { setNotice('请先确认本人声音或已获得合法授权'); return }
    setVoiceSampleBusy(true); setNotice('')
    try { const bytes = await recordingToWav(recordingBlob); const sample = await window.electronAPI.video.voice.samples.saveRecording(voiceSampleName, bytes, 'audio/wav', true); await refreshVoiceSamples(); setCloneSampleId(sample.id); setVoiceCloneOpen(false); setNotice(`克隆声音样本“${sample.name}”已保存`) }
    catch (error) { setNotice(friendlyError(error, '保存录音失败')) } finally { setVoiceSampleBusy(false) }
  }
  const uploadVoiceSample = async () => {
    if (!voiceAuthorized) { setNotice('请先确认本人声音或已获得合法授权'); return }
    setVoiceSampleBusy(true); setNotice('')
    try { const sample = await window.electronAPI.video.voice.samples.upload(voiceSampleName, true); if (sample) { await refreshVoiceSamples(); setCloneSampleId(sample.id); setVoiceCloneOpen(false); setNotice(`声音样本“${sample.name}”已导入`) } }
    catch (error) { setNotice(friendlyError(error, '导入声音样本失败')) } finally { setVoiceSampleBusy(false) }
  }
  const removeVoiceSample = async (sample: VoiceSample) => {
    const confirmed = await appDialog.confirm({ title: '删除声音样本', message: `确定删除“${sample.name}”吗？对应的本地录音文件也会同步删除。`, confirmLabel: '删除音色', tone: 'danger' }); if (!confirmed) return
    await window.electronAPI.video.voice.samples.delete(sample.id); if (cloneSampleId === sample.id) setCloneSampleId(0); await refreshVoiceSamples()
  }
  const generateCopy = async (action: VideoCopyInput['action']) => {
    if (!project) return
    if (action !== 'generate' && !draft.trim()) { setNotice('请先准备需要处理的文案'); return }
    if (action === 'generate' && mode !== 'original' && !draft.trim()) { setNotice('请先添加并解析参考内容'); return }
    if (action === 'generate' && mode === 'original' && !subject.trim()) { setNotice('请先输入创作主题'); return }
    const requestId = `video-copy-${Date.now()}`; setGenerating(requestId); setNotice('')
    try {
      const result = await window.electronAPI.video.copy.generate(requestId, project.id, { action, mode, source: draft, targetLength, language, subject, product, audience, platform, style, rewriteStrength })
      setGenerations((items) => [result, ...items]); if (result.kind === 'draft' || result.kind === 'translation') setDraft(result.content)
    } catch (error) { setNotice(friendlyError(error, '文案生成失败')) } finally { setGenerating('') }
  }
  const generateVoice = async (useClone = false) => {
    if (!draft.trim()) { setNotice('请先准备需要生成旁白的文案'); return }
    const selected = voiceProviders.find((item) => item.provider === voiceProvider)
    if (!selected?.configured || !selected.model) { setNotice('请先在“API 与模型”中配置语音服务商、API Key 和语音模型'); return }
    if (useClone && !cloneSampleId) { setVoiceAuthorized(false); setVoiceCloneOpen(true); setNotice('请先录制、上传或选择一个克隆音色'); return }
    if (useClone && !/^mimo-.*-tts/i.test(selected.model)) { setNotice('当前克隆音色仅支持 MiMo TTS 服务，请切换语音服务'); return }
    const requestId = `video-voice-${Date.now()}`; setGenerating(requestId); setNotice('')
    try { const result = await window.electronAPI.video.voice.generate(requestId, { text: draft, voice, speed: speechSpeed, emotion, provider: voiceProvider, projectId: project?.id, title: `${title || '视频项目'}-${useClone ? '克隆旁白' : '普通旁白'}`, cloneSampleId: useClone ? cloneSampleId : undefined }); setAudioResult(result); const rows = await window.electronAPI.video.personal.audioWorks(); setAudioWorks(rows); setPersonalAudioId(result.id); setNotice(`${useClone ? '克隆' : '普通'}旁白已生成并保存到“我的作品” · ${result.provider} · ${result.model}`) }
    catch (error) { setNotice(friendlyError(error, '旁白生成失败')) } finally { setGenerating('') }
  }
  const selectAvatarImage = async () => { try { const selected = await window.electronAPI.video.digitalHuman.selectImage(); if (selected) setAvatarImage(selected) } catch (error) { setNotice(friendlyError(error, '选择形象图片失败')) } }
  const avatarInput = () => ({ imagePath: avatarImage!.path, text: draft, ratio: avatarRatio, resolution: avatarResolution, duration: avatarDuration, motion: avatarMotion, provider: avatarProvider, videoModel: avatarVideoModel, projectId: project?.id, title: `${title || '视频项目'}-数字人口播` })
  const refreshAvatarTasks = async () => { const rows = await window.electronAPI.video.digitalHuman.list(project?.id); setAvatarTasks(rows); return rows }
  const generateAvatar = () => {
    if (!avatarImage) { setNotice('请先上传一张清晰的正面数字人形象图片'); return }
    if (!draft.trim()) { setNotice('请先在“内容构思”中准备数字人口播文案'); return }
    setAvatarConfirmOpen(true)
  }
  const submitAvatar = async () => {
    if (!avatarImage) return; setAvatarConfirmOpen(false)
    const requestId = `digital-human-${Date.now()}`; setAvatarRequestId(requestId); setAvatarProgress(1); setAvatarProgressText('正在准备数字人任务'); setGenerating(requestId); setNotice('')
    try { const result = await window.electronAPI.video.digitalHuman.generate(requestId, avatarInput()); setAvatarResult(result); setPolishSource({ path: result.filePath, name: result.title, duration: result.duration, dataUrl: result.dataUrl }); setPolishWorks(await window.electronAPI.video.polish.videoWorks()); setNotice('数字人视频已生成并同步到“我的作品”') }
    catch (error) { setNotice(friendlyError(error, '数字人视频生成失败')) } finally { setGenerating(''); setAvatarRequestId(''); await refreshAvatarTasks() }
  }
  const resumeAvatar = async (taskId: number) => {
    const requestId = `digital-human-resume-${taskId}-${Date.now()}`; setAvatarRequestId(requestId); setAvatarProgress(18); setAvatarProgressText('正在继续查询服务器结果'); setGenerating(requestId); setNotice('')
    try { const result = await window.electronAPI.video.digitalHuman.resume(requestId, taskId); setAvatarResult(result); setPolishSource({ path: result.filePath, name: result.title, duration: result.duration, dataUrl: result.dataUrl }); setPolishWorks(await window.electronAPI.video.polish.videoWorks()); setNotice('后台生成结果已同步到“我的作品”') }
    catch (error) { setNotice(friendlyError(error, '查询后台任务失败')) } finally { setGenerating(''); setAvatarRequestId(''); await refreshAvatarTasks() }
  }
  const recoverAvatar = async () => {
    if (!avatarImage) { setNotice('请先上传该后台任务使用的数字人形象图片'); return }; if (!draft.trim()) { setNotice('请保留或填写该任务使用的口播文案'); return }; if (!avatarUpstreamTaskId.trim()) { setNotice('请输入 DMXAPI 后台详情中的任务 ID'); return }
    const requestId = `digital-human-recover-${Date.now()}`; setAvatarRecoverOpen(false); setAvatarRequestId(requestId); setAvatarProgress(18); setAvatarProgressText('正在找回后台任务结果'); setGenerating(requestId); setNotice('')
    try { const result = await window.electronAPI.video.digitalHuman.recover(requestId, avatarUpstreamTaskId, avatarInput()); setAvatarResult(result); setPolishSource({ path: result.filePath, name: result.title, duration: result.duration, dataUrl: result.dataUrl }); setPolishWorks(await window.electronAPI.video.polish.videoWorks()); setAvatarUpstreamTaskId(''); setNotice('后台任务已找回，并同步到“我的作品”') }
    catch (error) { setNotice(friendlyError(error, '找回后台任务失败')) } finally { setGenerating(''); setAvatarRequestId(''); await refreshAvatarTasks() }
  }
  const stopAvatarWaiting = async () => {
    if (!avatarRequestId) return; await window.electronAPI.video.digitalHuman.stop(avatarRequestId); setNotice('已停止本地等待；服务器任务不会取消，仍可能继续生成和计费。稍后可在生成记录中继续查询。')
  }
  const selectPersonalVideo = async () => { try { const selected = await window.electronAPI.video.personal.selectVideo(); if (selected) setPersonalVideo(selected) } catch (error) { setNotice(friendlyError(error, '选择人物视频失败')) } }
  const composePersonal = async () => {
    if (!personalVideo) { setNotice('请先上传一段本人出镜视频'); return }; if (!personalAudioId) { setNotice('请先在声音生成中生成旁白，或选择已有旁白'); return }
    const requestId = `personal-video-${Date.now()}`; setGenerating(requestId); setPersonalProgress(1); setPersonalProgressText('正在准备本地音画合成'); setNotice('')
    try { const result = await window.electronAPI.video.personal.compose(requestId, { videoPath: personalVideo.path, audioWorkId: personalAudioId, projectId: project?.id, title: `${title || '视频项目'}-本人出镜成片` }); setPersonalResult(result); setPolishSource({ path: result.filePath, name: result.title, duration: result.duration, dataUrl: result.dataUrl }); setPolishWorks(await window.electronAPI.video.polish.videoWorks()); setNotice('本人视频与旁白已合成并保存到“我的作品”') }
    catch (error) { setNotice(friendlyError(error, '音画合成失败')) } finally { setGenerating('') }
  }
  const selectPolishVideo = async () => { try { const selected = await window.electronAPI.video.polish.selectVideo(); if (selected) setPolishSource(selected) } catch (error) { setNotice(friendlyError(error, '选择成片失败')) } }
  const selectPolishMusic = async () => { try { const selected = await window.electronAPI.video.polish.selectMusic(); if (selected) setPolishMusic(selected) } catch (error) { setNotice(friendlyError(error, '选择背景音乐失败')) } }
  const renderPolishedVideo = async () => {
    if (!polishSource) { setNotice('请先选择需要润色的视频'); return }
    const requestId = `polish-video-${Date.now()}`; setGenerating(requestId); setPolishProgress(1); setPolishProgressText('正在准备本地成片渲染'); setNotice('')
    try { const result = await window.electronAPI.video.polish.render(requestId, { sourcePath: polishSource.path, title: `${title || '视频项目'}-润色成片`, subtitleText: draft, burnSubtitles, subtitleSize, subtitleColor, subtitlePosition, musicPath: polishMusic?.path, sourceVolume, musicVolume, ratio: polishRatio, quality: polishQuality, trimStart, trimEnd, projectId: project?.id }); setPolishResult(result); setPolishSource({ path: result.filePath, name: result.title, duration: result.duration, dataUrl: result.dataUrl }); setPolishWorks(await window.electronAPI.video.polish.videoWorks()); setNotice('润色成片已导出并保存到“我的作品”') }
    catch (error) { setNotice(friendlyError(error, '成片润色失败')) } finally { setGenerating('') }
  }

  return <main className="video-page">
    <header className="video-hero"><div><p className="home-kicker">RAINBOW AI · VIDEO STUDIO</p><h1>视频创作</h1><p>从视频链接或本地素材开始，完成解析、脚本、声音、画面和发布。</p></div><div className="video-project-bar"><select value={project?.id ?? ''} onChange={(event) => void loadProject(Number(event.target.value))}>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="项目名称" /><small>{saved}</small><button className="video-quiet-button" onClick={async () => { const created = await window.electronAPI.video.projects.create('未命名视频项目'); await refreshProjects(); await loadProject(created.id) }}>＋ 新建项目</button></div></header>
    <div className="video-toolbar"><div className="video-mode"><button>分步处理</button><button className="selected">智能串联</button></div><button className="video-flow-button">⚡ 一键串联后续流程</button></div>
    {notice && <div className="video-notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <div className="video-workflow"><div className="video-column"><StepCard number="01" title="内容构思" hint="先导入并解析视频内容" className="video-content-card">
      <div className="video-segmented"><button className={mode === 'breakdown' ? 'selected' : ''} onClick={() => setMode('breakdown')}>拆解参考</button><button className={mode === 'inspiration' ? 'selected' : ''} onClick={() => setMode('inspiration')}>借灵感</button><button className={mode === 'original' ? 'selected' : ''} onClick={() => setMode('original')}>从零起稿</button></div>
      {mode === 'original' && <div className="video-brief-grid"><Field label="创作主题"><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="例如：AI 如何提高内容效率" /></Field><Field label="产品/内容信息"><input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="产品卖点或核心信息" /></Field><Field label="目标受众"><input value={audience} onChange={(event) => setAudience(event.target.value)} /></Field><Field label="发布平台"><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option>抖音</option><option>小红书</option><option>B站</option><option>视频号</option><option>通用短视频平台</option></select></Field><Field label="文案风格"><select value={style} onChange={(event) => setStyle(event.target.value)}><option>自然、有吸引力</option><option>专业可信</option><option>轻松幽默</option><option>情绪共鸣</option><option>强节奏带货</option></select></Field></div>}
      {mode === 'inspiration' && <Field label={`原创改写强度 ${rewriteStrength}%`}><input type="range" min="20" max="100" value={rewriteStrength} onChange={(event) => setRewriteStrength(Number(event.target.value))} /></Field>}
      {sources.length === 0 ? <div className="video-empty-source"><strong>第一步：添加视频链接</strong><p>支持抖音、B站、小红书、快手和 YouTube 链接，也可添加本地视频或直接粘贴文案。</p><button className="dark-button wide-button" onClick={() => { setSourceTab('url'); setDialogOpen(true) }}>＋ 添加视频来源</button></div> : <div className="video-source-list">{sources.map((source) => <article key={source.id}><div className={`video-source-icon ${source.source_type}`}>{source.source_type === 'url' ? '↗' : source.source_type === 'file' ? '▶' : 'T'}</div><div><strong>{source.display_name}</strong><small>{source.platform}{source.duration ? ` · ${formatDuration(source.duration)}` : ''}{source.file_size ? ` · ${formatBytes(source.file_size)}` : ''}</small><span className={`source-status ${source.status}`}>{sourceProgress[source.id]?.message || (source.transcript?.status === 'completed' ? '已完成转写' : source.status === 'failed' ? source.error : source.source_type === 'url' ? '等待在线解析' : '等待解析')}</span>{sourceProgress[source.id] && <div className="source-progress"><i style={{ width: `${sourceProgress[source.id].progress}%` }} /></div>}</div><div className="video-source-actions">{busy === source.id ? <button onClick={() => void window.electronAPI.video.sources.stop(source.id)}>停止</button> : <button onClick={() => void transcribe(source)}>{source.transcript?.status === 'completed' ? '重新解析' : '解析文案'}</button>}<button onClick={() => void removeSource(source.id)}>×</button></div></article>)}<button className="video-add-more" onClick={() => setDialogOpen(true)}>＋ 继续添加来源</button></div>}
      <div className="video-two-fields"><Field label="语言"><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="zh">中文</option><option value="en">英文</option><option value="auto">自动识别</option></select></Field><Field label="目标字数"><input type="number" min="30" max="5000" value={targetLength} onChange={(event) => setTargetLength(Number(event.target.value) || 100)} /></Field></div>
      <Field label={mode === 'breakdown' ? '原始转写文案' : '解析文案 / 灵感草稿'}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === 'original' ? '生成的新文案会显示在这里…' : '转写结果会自动带到这里，也可以直接编辑…'} /></Field>
      <button className="pastel-button wide-button video-generate-copy" disabled={Boolean(generating)} onClick={() => void generateCopy('generate')}>{generating ? 'AI 正在处理…' : mode === 'breakdown' ? '✦ 生成拆解报告' : mode === 'inspiration' ? '✦ 生成原创文案' : '✦ 从零生成文案'}</button>
      <div className="video-action-row video-copy-tools"><button className="dark-button" disabled={Boolean(generating)} onClick={() => void generateCopy('legal')}>♢ AI 法务检查</button></div>
      {generations.length > 0 && <div className="video-results"><header><strong>文案结果与版本</strong></header>{generations.slice(0, 6).map((item) => <article key={item.id}><div><b>{item.kind === 'breakdown' ? '拆解报告' : item.kind === 'legal' ? '法务检查' : '生成文案'}</b><small>{item.provider} · {item.model} · {new Date(item.created_at).toLocaleString('zh-CN')}</small></div><p>{item.content}</p><footer><button onClick={() => { navigator.clipboard.writeText(item.content); setNotice('已复制文案') }}>复制</button><button onClick={() => setDraft(item.content)}>用于创作</button><button onClick={async () => { await window.electronAPI.video.copy.delete(item.id); setGenerations((rows) => rows.filter((row) => row.id !== item.id)) }}>删除</button></footer></article>)}</div>}
    </StepCard></div>
    <div className="video-column">
      <StepCard number="02" title="声音生成" hint="将当前文案生成可试听旁白" className="video-voice-card">
        <Field label="语音服务"><select value={voiceProvider} onChange={(event) => { const next = event.target.value; setVoiceProvider(next); const model = voiceProviders.find((item) => item.provider === next)?.model || ''; if (/^mimo-.*-tts/i.test(model)) setVoice('mimo_default'); else if (voice === 'mimo_default') setVoice('alloy') }}><option value="">请选择已配置的语音服务</option>{voiceProviders.map((item) => <option key={item.provider} value={item.provider}>{item.provider} · {item.model || '未设置语音模型'}{item.configured ? '' : '（未配置 Key）'}</option>)}</select></Field>
        <Field label="普通旁白音色"><input list="voice-options" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="MiMo 推荐 mimo_default；OpenAI 可用 alloy" /><datalist id="voice-options"><option value="mimo_default" /><option value="冰糖" /><option value="Mia" /><option value="Chloe" /><option value="Milo" /><option value="Dean" /><option value="alloy" /><option value="nova" /><option value="shimmer" /><option value="onyx" /><option value="echo" /><option value="coral" /><option value="sage" /></datalist></Field>
        <Field label="克隆音色"><div className="video-upload-row"><select value={cloneSampleId} onChange={(event) => setCloneSampleId(Number(event.target.value))}><option value={0}>请选择已保存的克隆音色</option>{voiceSamples.map((sample) => <option key={sample.id} value={sample.id}>{sample.missing ? '⚠ ' : '我的音色 · '}{sample.name}</option>)}</select><button onClick={() => { setVoiceAuthorized(false); setVoiceCloneOpen(true) }}>{voiceSamples.length ? '管理' : '添加'}</button></div></Field>
        {cloneSampleId > 0 && <div className="voice-clone-selected"><span>◎</span><div><strong>{voiceSamples.find((item) => item.id === cloneSampleId)?.name || '克隆音色'}</strong><small>点击“使用克隆音色”时调用 voiceclone 模型</small></div><button onClick={() => setCloneSampleId(0)}>取消选择</button></div>}
        <div className="video-two-fields"><Field label="表达情绪"><select value={emotion} onChange={(event) => setEmotion(event.target.value)}><option>自然</option><option>活泼</option><option>专业</option><option>温柔</option></select></Field><Field label={`语速 ${speechSpeed.toFixed(2)}x`}><input type="range" min="0.75" max="1.5" step="0.05" value={speechSpeed} onChange={(event) => setSpeechSpeed(Number(event.target.value))} /></Field></div>
        <div className="voice-generate-actions"><button className="pastel-button voice-normal-button" disabled={Boolean(generating)} onClick={() => void generateVoice(false)}>♫ <span>{generating.startsWith('video-voice') ? '正在生成…' : '生成普通旁白'}</span><small>使用预置音色</small></button><button className="voice-clone-button" disabled={Boolean(generating)} onClick={() => void generateVoice(true)}>◎ <span>{cloneSampleId ? '使用克隆音色' : '添加并克隆音色'}</span><small>{cloneSampleId ? '复刻已选声音' : '先录音或上传样本'}</small></button></div>
        <div className="video-preview-box small"><strong>声音预览</strong>{audioResult ? <><audio controls src={audioResult.dataUrl} /><div className="video-audio-actions"><button onClick={() => void window.electronAPI.works.downloadFile(audioResult.filePath, audioResult.title)}>下载旁白</button><button onClick={() => void window.electronAPI.works.openLocation(audioResult.filePath)}>打开位置</button><button onClick={() => void generateVoice(audioResult.model === 'mimo-v2.5-tts-voiceclone')}>重新生成</button></div><small>{audioResult.provider} · {audioResult.model}</small></> : <small>选择普通旁白或克隆音色生成，结果会自动保存到“我的作品”</small>}</div>
      </StepCard>
      <StepCard number="03" title="数字人生成" hint="形象图片与文案直接生成有声口播视频" className="video-avatar-card">
        <div className="avatar-mode-tabs"><button className={avatarMode === 'image' ? 'selected' : ''} onClick={() => setAvatarMode('image')}>图片数字人</button><button className={avatarMode === 'personal' ? 'selected' : ''} onClick={() => setAvatarMode('personal')}>本人视频＋旁白</button></div>
        {avatarMode === 'image' && <>
        <div className="avatar-mode-label"><b>图片数字人</b><span>{avatarProvider} · {avatarVideoModel}</span></div>
        <div className="avatar-provider-fields"><Field label="视频服务商"><select value={avatarProvider} onChange={(event) => { const next = event.target.value; const provider = videoProviders.find((item) => item.provider === next); setAvatarProvider(next); setAvatarVideoModel(provider?.models[0] || '') }}><option value="">请选择视频服务商</option>{videoProviders.map((item) => <option key={item.provider} value={item.provider}>{item.provider}{item.configured ? '' : '（未配置 Key）'}</option>)}</select></Field><Field label="视频模型"><select value={avatarVideoModel} onChange={(event) => setAvatarVideoModel(event.target.value)}>{(videoProviders.find((item) => item.provider === avatarProvider)?.models || []).map((model) => <option key={model} value={model}>{model}</option>)}</select></Field></div>
        <button className={`avatar-image-picker ${avatarImage ? 'has-image' : ''}`} onClick={() => void selectAvatarImage()}>{avatarImage ? <><img src={avatarImage.dataUrl} alt="数字人形象" /><span><b>{avatarImage.name}</b><small>点击更换人物形象</small></span></> : <><i>＋</i><span><b>上传数字人形象</b><small>建议正面、清晰、半身或近景照片</small></span></>}</button>
        <Field label="口播文案"><textarea className="avatar-script" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="使用内容构思中的文案，也可在这里修改…" /></Field>
        <div className="avatar-settings"><Field label="画面比例"><select value={avatarRatio} onChange={(event) => setAvatarRatio(event.target.value)}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option><option value="adaptive">跟随原图</option></select></Field><Field label="清晰度"><select value={avatarResolution} onChange={(event) => setAvatarResolution(event.target.value)}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></Field><Field label="时长"><select value={avatarDuration} onChange={(event) => setAvatarDuration(Number(event.target.value))}><option value={5}>5 秒</option><option value={8}>8 秒</option><option value={10}>10 秒</option><option value={12}>12 秒</option></select></Field><Field label="动作"><select value={avatarMotion} onChange={(event) => setAvatarMotion(event.target.value)}><option value="calm">沉稳克制</option><option value="natural">自然表达</option><option value="expressive">活泼丰富</option></select></Field></div>
        {avatarProgress > 0 && avatarProgress < 100 && <div className="avatar-progress"><div><span>{avatarProgressText}</span><b>{avatarProgress}%</b></div><i><em style={{ width: `${avatarProgress}%` }} /></i></div>}
        {generating.startsWith('digital-human') ? <button className="avatar-stop-button wide-button" onClick={() => void stopAvatarWaiting()}>■ 仅停止本地等待</button> : <button className="pastel-button wide-button avatar-generate" onClick={generateAvatar}>▶ 检查参数并提交　✦</button>}
        <div className={`video-preview-box avatar-video-preview ${avatarResult ? 'has-video' : ''}`}>{avatarResult ? <><video controls src={avatarResult.dataUrl} /><div className="video-audio-actions"><button onClick={() => void window.electronAPI.works.downloadFile(avatarResult.filePath, avatarResult.title)}>下载视频</button><button onClick={() => void window.electronAPI.works.openLocation(avatarResult.filePath)}>打开位置</button><button onClick={generateAvatar}>重新生成</button></div><small>{avatarResult.model} · {avatarResult.resolution} · {avatarResult.duration} 秒</small></> : <><strong>数字人视频预览</strong><small>完成的后台任务可从下方生成记录同步</small></>}</div>
        <div className="avatar-task-heading"><div><b>生成任务记录</b><small>任务 ID 会保存，软件重启后仍可继续查询</small></div><button onClick={() => setAvatarRecoverOpen(true)}>＋ 找回旧任务</button></div>
        <div className="avatar-task-list">{avatarTasks.length ? avatarTasks.slice(0, 6).map((task) => <article key={task.id}><div className={`avatar-task-status ${task.status}`}>{task.status === 'completed' ? '完成' : task.status === 'failed' ? '失败' : task.status === 'local_stopped' ? '已暂停' : '生成中'}</div><div><strong>{task.duration}秒 · {task.resolution} · {task.ratio}</strong><small>{task.upstream_task_id ? `任务 ID：${task.upstream_task_id}` : '正在获取服务器任务 ID'}</small><span>{task.error || task.message}</span></div>{task.status === 'completed' && task.file_path ? <button onClick={() => void window.electronAPI.works.openLocation(task.file_path)}>打开</button> : task.upstream_task_id ? <button disabled={Boolean(generating)} onClick={() => void resumeAvatar(task.id)}>继续查询</button> : null}</article>) : <p>还没有已保存的数字人任务</p>}</div>
        <p className="avatar-cost-note">提交后服务器通常会立即计费，停止本地等待不会取消后台任务。相同参数的进行中任务会自动拦截重复提交。GeekAI 的不同模型价格和音画能力以其模型页为准。</p></>}
        {avatarMode === 'personal' && <div className="personal-video-panel">
          <div className="personal-mode-note"><b>本人出镜音画合成</b><span>本地处理，不调用付费视频模型；当前为旁白合成，不改变人物口型。</span></div>
          <button className={`personal-video-picker ${personalVideo ? 'has-video' : ''}`} onClick={() => void selectPersonalVideo()}>{personalVideo ? <><video muted src={personalVideo.dataUrl} /><span><b>{personalVideo.name}</b><small>{personalVideo.duration ? `${personalVideo.duration.toFixed(1)} 秒 · ` : ''}{formatBytes(personalVideo.fileSize)} · 点击更换</small></span></> : <><i>▶</i><span><b>上传本人无声视频</b><small>支持 MP4、MOV、MKV、WebM、AVI、M4V</small></span></>}</button>
          <Field label="选择旁白"><select value={personalAudioId} onChange={(event) => setPersonalAudioId(Number(event.target.value))}><option value={0}>请选择“声音生成”保存的旁白</option>{audioWorks.map((item) => <option key={item.id} value={item.id} disabled={Boolean(item.missing)}>{item.missing ? '⚠ 文件丢失 · ' : ''}{item.title} · {item.model}</option>)}</select></Field>
          {personalAudioId > 0 && audioWorks.find((item) => item.id === personalAudioId)?.dataUrl && <audio className="personal-audio-preview" controls src={audioWorks.find((item) => item.id === personalAudioId)?.dataUrl} />}
          {personalProgress > 0 && personalProgress < 100 && <div className="avatar-progress"><div><span>{personalProgressText}</span><b>{personalProgress}%</b></div><i><em style={{ width: `${personalProgress}%` }} /></i></div>}
          {generating.startsWith('personal-video') ? <button className="avatar-stop-button wide-button" onClick={() => void window.electronAPI.video.personal.stop(generating)}>■ 停止本地合成</button> : <button className="pastel-button wide-button avatar-generate" onClick={() => void composePersonal()}>▶ 合成旁白成片　✦</button>}
          <div className={`video-preview-box avatar-video-preview ${personalResult ? 'has-video' : ''}`}>{personalResult ? <><video controls src={personalResult.dataUrl} /><div className="video-audio-actions"><button onClick={() => void window.electronAPI.works.downloadFile(personalResult.filePath, personalResult.title)}>下载成片</button><button onClick={() => void window.electronAPI.works.openLocation(personalResult.filePath)}>打开位置</button></div><small>{personalResult.model} · {personalResult.duration} 秒</small></> : <><strong>本人视频成片预览</strong><small>视频会自动循环或裁切到旁白时长</small></>}</div>
          <p className="avatar-cost-note">精准口型同步需要独立的口型模型。本功能目前完成视频与旁白的本地合成，不会产生视频 API 费用。</p>
        </div>}
      </StepCard>
    </div>
    <div className="video-column video-right-column">
      <StepCard number="04" title="成片润色" hint="字幕、配乐、画幅和音量本地渲染" className="video-polish-card">
        <Field label="选择需要润色的成片"><div className="video-upload-row"><select value={polishSource?.path || ''} onChange={(event) => { const work = polishWorks.find((item) => item.file_path === event.target.value); if (work) setPolishSource({ path: work.file_path, name: work.title, duration: work.duration, dataUrl: work.dataUrl }) }}><option value="">请选择“我的作品”视频</option>{polishWorks.map((work) => <option key={work.id} value={work.file_path}>{work.title} · {work.duration}秒</option>)}</select><button onClick={() => void selectPolishVideo()}>本地视频</button></div></Field>
        <div className={`polish-source-preview ${polishSource ? 'has-video' : ''}`}>{polishSource ? <><video controls src={polishSource.dataUrl} /><div><strong>{polishSource.name}</strong><small>{polishSource.duration ? `${polishSource.duration} 秒` : '时长待检测'}</small></div></> : <><strong>尚未选择成片</strong><small>数字人或本人视频生成完成后会自动带入</small></>}</div>
        <Field label="字幕文案"><textarea className="polish-subtitle-text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="当前文案会自动分句并匹配视频时长…" /></Field>
        <div className="polish-subtitle-options"><label><input type="checkbox" checked={burnSubtitles} onChange={(event) => setBurnSubtitles(event.target.checked)} /> 烧录字幕</label><label>字号<input type="number" min="14" max="48" value={subtitleSize} onChange={(event) => setSubtitleSize(Number(event.target.value) || 26)} /></label><label>颜色<input type="color" value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value)} /></label><label>位置<select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value as 'bottom' | 'center' | 'top')}><option value="bottom">底部</option><option value="center">居中</option><option value="top">顶部</option></select></label></div>
        <Field label="背景音乐"><div className="video-upload-row"><input value={polishMusic?.name || ''} readOnly placeholder="未添加背景音乐" /><button onClick={() => void selectPolishMusic()}>{polishMusic ? '更换' : '上传'}</button>{polishMusic && <button onClick={() => setPolishMusic(null)}>移除</button>}</div></Field>
        {polishMusic && <audio className="polish-music-preview" controls src={polishMusic.dataUrl} />}
        <div className="video-two-fields"><Field label={`原声/旁白音量 ${sourceVolume}%`}><input type="range" min="0" max="200" value={sourceVolume} onChange={(event) => setSourceVolume(Number(event.target.value))} /></Field><Field label={`配乐音量 ${musicVolume}%`}><input type="range" min="0" max="100" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></Field></div>
        <div className="polish-output-grid"><Field label="画面比例"><select value={polishRatio} onChange={(event) => setPolishRatio(event.target.value as '9:16' | '16:9' | '1:1')}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></Field><Field label="导出画质"><select value={polishQuality} onChange={(event) => setPolishQuality(event.target.value as '720p' | '1080p')}><option value="720p">720p</option><option value="1080p">1080p</option></select></Field><Field label="裁剪开头（秒）"><input type="number" min="0" step="0.1" value={trimStart} onChange={(event) => setTrimStart(Number(event.target.value) || 0)} /></Field><Field label="裁剪结尾（秒）"><input type="number" min="0" step="0.1" value={trimEnd} onChange={(event) => setTrimEnd(Number(event.target.value) || 0)} /></Field></div>
        {polishProgress > 0 && polishProgress < 100 && <div className="avatar-progress polish-progress"><div><span>{polishProgressText}</span><b>{polishProgress}%</b></div><i><em style={{ width: `${polishProgress}%` }} /></i></div>}
        {generating.startsWith('polish-video') ? <button className="avatar-stop-button wide-button" onClick={() => void window.electronAPI.video.polish.stop(generating)}>■ 停止本地渲染</button> : <button className="pastel-button wide-button" disabled={!polishSource} onClick={() => void renderPolishedVideo()}>✂ 导出润色成片　✦</button>}
        {polishResult && <div className="polish-result-actions"><span>已导出：{polishResult.title}</span><button onClick={() => void window.electronAPI.works.openLocation(polishResult.filePath)}>打开位置</button><button onClick={() => void window.electronAPI.works.downloadFile(polishResult.filePath, polishResult.title)}>下载视频</button>{polishResult.subtitlePath && <button onClick={() => void window.electronAPI.works.downloadFile(polishResult.subtitlePath, `${polishResult.title}.srt`)}>导出 SRT</button>}</div>}
      </StepCard>
      <StepCard number="05" title="进入内容发布" hint="带着成片与文案继续完成发布" className="video-publish-card"><div className="video-publish-entry"><div className="video-publish-readiness"><article className={draft.trim() ? 'ready' : ''}><i>{draft.trim() ? '✓' : '1'}</i><span><b>发布文案</b><small>{draft.trim() ? `已准备 ${draft.trim().length} 字` : '先在内容构思中生成或填写文案'}</small></span></article><article className={polishResult || personalResult || avatarResult ? 'ready' : ''}><i>{polishResult || personalResult || avatarResult ? '✓' : '2'}</i><span><b>视频成片</b><small>{polishResult?.title || personalResult?.title || avatarResult?.title || '可先生成成片，也可以仅携带文案'}</small></span></article><article className="ready"><i>✓</i><span><b>目标平台</b><small>{platform || '进入发布中心后选择账号'}</small></span></article></div><div className="video-publish-note"><b>发布中心负责最后一步</b><span>这里不再重复填写标题和标签。进入后可选择账号、关联项目、检查平台规则并打开官方创作页。</span></div><button className="pastel-button wide-button publish-entry-button" disabled={!draft.trim() && !(polishResult || personalResult || avatarResult)} onClick={() => { const result = polishResult || personalResult || avatarResult; onPublish({ title: title || result?.title || '视频发布内容', body: draft, topics: platform ? `#${platform}` : '', projectId: project?.id ?? null, workKey: result ? `video-${result.id}` : undefined }) }}>进入内容发布　→</button></div></StepCard>
    </div></div>
    {dialogOpen && <div className="video-source-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false) }}><section><header><div><strong>添加视频来源</strong><small>支持直接粘贴完整平台分享口令</small></div><button onClick={() => setDialogOpen(false)}>×</button></header><div className="source-tabs"><button className={sourceTab === 'url' ? 'selected' : ''} onClick={() => setSourceTab('url')}>视频链接</button><button className={sourceTab === 'file' ? 'selected' : ''} onClick={() => setSourceTab('file')}>本地视频</button><button className={sourceTab === 'text' ? 'selected' : ''} onClick={() => setSourceTab('text')}>手动文案</button></div>{sourceTab === 'url' && <><Field label="视频链接或分享口令"><textarea autoFocus value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="可粘贴整段抖音分享文字，软件会自动提取其中的链接…" /></Field><p>确认后点击来源卡片的“解析文案”，软件将自动下载音频并使用 API 配置页选定的转写方式。受平台限制的链接可能需要改用本地视频。</p></>}{sourceTab === 'file' && <div className="source-file-hint"><b>选择本地视频文件</b><span>支持 MP4、MOV、MKV、WebM、AVI、M4V</span></div>}{sourceTab === 'text' && <Field label="参考文案"><textarea autoFocus value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="粘贴已有字幕、口播稿或灵感文案…" /></Field>}<footer><button onClick={() => setDialogOpen(false)}>取消</button><button className="pastel-button" disabled={busy === 'add' || (sourceTab !== 'file' && !sourceValue.trim())} onClick={() => void addSource()}>{busy === 'add' ? '添加中…' : sourceTab === 'file' ? '选择文件' : '确认添加'}</button></footer></section></div>}
    {avatarConfirmOpen && <div className="video-source-modal avatar-confirm-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setAvatarConfirmOpen(false) }}><section><header><div><strong>确认提交付费生成任务</strong><small>提交到 {avatarProvider} 后通常无法撤回</small></div><button onClick={() => setAvatarConfirmOpen(false)}>×</button></header><div className="avatar-confirm-summary"><article><span>服务商</span><b>{avatarProvider}</b></article><article><span>模型</span><b>{avatarVideoModel}</b></article><article><span>时长</span><b>{avatarDuration} 秒</b></article><article><span>清晰度</span><b>{avatarResolution}</b></article><article><span>画面比例</span><b>{avatarRatio}</b></article><article><span>参考费用</span><b>以服务商实际计费为准</b></article></div><div className="avatar-billing-warning"><b>请再次核对秒数和模型</b><span>不同视频服务商的计费和音画能力不同。提交后按钮会锁定，任务会保存到生成记录。</span></div><footer><button onClick={() => setAvatarConfirmOpen(false)}>返回修改</button><button className="pastel-button" onClick={() => void submitAvatar()}>确认提交并可能立即计费</button></footer></section></div>}
    {avatarRecoverOpen && <div className="video-source-modal avatar-recover-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setAvatarRecoverOpen(false) }}><section><header><div><strong>找回 DMXAPI 后台任务</strong><small>适用于后台已成功、软件未同步的旧任务</small></div><button onClick={() => setAvatarRecoverOpen(false)}>×</button></header><Field label="服务器任务 ID"><input autoFocus value={avatarUpstreamTaskId} onChange={(event) => setAvatarUpstreamTaskId(event.target.value)} placeholder="从 DMXAPI 任务详情复制 ID" /></Field><div className="avatar-billing-warning safe"><b>该操作只查询，不会重新提交生成</b><span>请先在当前页面选择原任务使用的形象图，并尽量还原时长、分辨率和文案，便于正确保存作品信息。</span></div><footer><button onClick={() => setAvatarRecoverOpen(false)}>取消</button><button className="pastel-button" onClick={() => void recoverAvatar()}>查询并同步结果</button></footer></section></div>}
    {voiceCloneOpen && <div className="video-source-modal voice-clone-modal" onMouseDown={(event) => { if (event.target === event.currentTarget && !recording) setVoiceCloneOpen(false) }}><section><header><div><strong>我的克隆音色</strong><small>在线录音或导入本地声音样本</small></div><button disabled={recording} onClick={() => setVoiceCloneOpen(false)}>×</button></header><div className="voice-clone-warning"><b>服务提示</b><span>小米官方克隆模型为 mimo-v2.5-tts-voiceclone；极客智坊模型广场目前未确认上架。样本可以先保存，生成能力以服务商实际开放情况为准。</span></div><div className="source-tabs voice-clone-tabs"><button className={voiceCloneTab === 'record' ? 'selected' : ''} onClick={() => setVoiceCloneTab('record')}>在线录音</button><button className={voiceCloneTab === 'upload' ? 'selected' : ''} onClick={() => setVoiceCloneTab('upload')}>本地上传</button></div><Field label="音色名称"><input value={voiceSampleName} onChange={(event) => setVoiceSampleName(event.target.value)} maxLength={40} placeholder="例如：我的旁白声音" /></Field>{voiceCloneTab === 'record' ? <div className={`voice-recorder ${recording ? 'is-recording' : ''}`}><div className="voice-recorder-icon">{recording ? '●' : '◉'}</div><strong>{recording ? '正在录音…' : recordingBlob ? '录音完成，可以试听' : '建议录制 10–30 秒清晰人声'}</strong><small>保持环境安静，使用自然语速连续朗读；保存时会自动转换为 MiMo 支持的 WAV。</small>{recordingUrl && <audio controls src={recordingUrl} />}{recording ? <button className="voice-record-stop" onClick={stopVoiceRecording}>■ 停止录音</button> : <button onClick={() => void startVoiceRecording()}>{recordingBlob ? '重新录制' : '● 开始录音'}</button>}</div> : <div className="voice-upload-box"><b>选择本地声音样本</b><span>MiMo 克隆接口仅支持 MP3、WAV；文件需在 7.5 MB 以内</span><button disabled={!voiceAuthorized || voiceSampleBusy} onClick={() => void uploadVoiceSample()}>{voiceSampleBusy ? '导入中…' : '选择音频文件'}</button></div>}<label className="voice-authorization"><input type="checkbox" checked={voiceAuthorized} onChange={(event) => setVoiceAuthorized(event.target.checked)} /><span>我确认这是本人声音，或已获得声音权利人的明确授权，并同意将样本发送给所选 API 服务商进行音色克隆。</span></label>{voiceSamples.length > 0 && <div className="voice-sample-library"><header><strong>已保存音色</strong><small>{voiceSamples.length} 个</small></header>{voiceSamples.map((sample) => <article key={sample.id} className={sample.id === cloneSampleId ? 'selected' : ''}><button className="voice-sample-play" disabled={Boolean(sample.missing)} onClick={() => { if (!sample.missing) setCloneSampleId(sample.id) }}>{sample.source_type === 'recording' ? 'REC' : 'FILE'}</button><div><input defaultValue={sample.name} onBlur={async (event) => { const name = event.target.value.trim(); if (name && name !== sample.name) { const updated = await window.electronAPI.video.voice.samples.rename(sample.id, name); if (updated) setVoiceSamples((rows) => rows.map((row) => row.id === updated.id ? updated : row)) } }} /><small>{sample.missing ? '本地文件丢失' : `${formatBytes(sample.file_size)} · ${sample.source_type === 'recording' ? '在线录音' : '本地上传'}`}</small></div>{sample.data_url && <audio controls src={sample.data_url} />}<button className="voice-sample-use" disabled={Boolean(sample.missing)} onClick={() => { setCloneSampleId(sample.id); setVoiceCloneOpen(false) }}>使用</button><button className="voice-sample-delete" onClick={() => void removeVoiceSample(sample)}>删除</button></article>)}</div>}<footer><button disabled={recording} onClick={() => setVoiceCloneOpen(false)}>关闭</button>{voiceCloneTab === 'record' && <button className="pastel-button" disabled={!recordingBlob || !voiceAuthorized || voiceSampleBusy} onClick={() => void saveVoiceRecording()}>{voiceSampleBusy ? '保存中…' : '保存并使用录音'}</button>}</footer></section></div>}
    <AppDialog controller={appDialog} />
  </main>
}
