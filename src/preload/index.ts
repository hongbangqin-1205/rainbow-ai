import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideoFile: () => ipcRenderer.invoke('select-video-file') as Promise<string | null>,
  storage: { status: () => ipcRenderer.invoke('storage:status'), choose: () => ipcRenderer.invoke('storage:choose') },
  video: {
    projects: {
      list: () => ipcRenderer.invoke('video:projects:list'),
      create: (title?: string) => ipcRenderer.invoke('video:projects:create', title),
      load: (id: number) => ipcRenderer.invoke('video:projects:load', id),
      update: (id: number, input: VideoProjectInput) => ipcRenderer.invoke('video:projects:update', id, input)
    },
    sources: {
      addUrl: (projectId: number, value: string) => ipcRenderer.invoke('video:sources:add-url', projectId, value),
      addFile: (projectId: number) => ipcRenderer.invoke('video:sources:add-file', projectId),
      addText: (projectId: number, content: string) => ipcRenderer.invoke('video:sources:add-text', projectId, content),
      delete: (id: number) => ipcRenderer.invoke('video:sources:delete', id),
      transcribe: (id: number, language: string, engine?: 'local' | 'api', provider?: string) => ipcRenderer.invoke('video:sources:transcribe', id, language, engine, provider),
      stop: (id: number) => ipcRenderer.invoke('video:sources:stop', id),
      onProgress: (callback: (payload: VideoSourceProgress) => void) => { const listener = (_event: Electron.IpcRendererEvent, payload: VideoSourceProgress) => callback(payload); ipcRenderer.on('video:source:progress', listener); return () => ipcRenderer.removeListener('video:source:progress', listener) }
    },
    copy: { generate: (requestId: string, projectId: number, input: VideoCopyInput) => ipcRenderer.invoke('video:copy:generate', requestId, projectId, input), stop: (requestId: string) => ipcRenderer.invoke('video:copy:stop', requestId), delete: (id: number) => ipcRenderer.invoke('video:copy:delete', id) },
    voice: {
      providers: () => ipcRenderer.invoke('video:voice:providers'),
      generate: (requestId: string, input: { text: string; voice: string; speed: number; emotion?: string; provider?: string; projectId?: number; title?: string; cloneSampleId?: number }) => ipcRenderer.invoke('video:voice:generate', requestId, input),
      samples: {
        list: () => ipcRenderer.invoke('video:voice:samples:list'),
        upload: (name: string, authorized: boolean) => ipcRenderer.invoke('video:voice:samples:upload', name, authorized),
        saveRecording: (name: string, bytes: Uint8Array, mimeType: string, authorized: boolean) => ipcRenderer.invoke('video:voice:samples:save-recording', name, bytes, mimeType, authorized),
        rename: (id: number, name: string) => ipcRenderer.invoke('video:voice:samples:rename', id, name),
        delete: (id: number) => ipcRenderer.invoke('video:voice:samples:delete', id)
      }
    },
    digitalHuman: {
      selectImage: () => ipcRenderer.invoke('video:digital-human:select-image'),
      providers: () => ipcRenderer.invoke('video:digital-human:providers'),
      list: (projectId?: number) => ipcRenderer.invoke('video:digital-human:list', projectId),
      generate: (requestId: string, input: DigitalHumanInput) => ipcRenderer.invoke('video:digital-human:generate', requestId, input),
      resume: (requestId: string, taskId: number) => ipcRenderer.invoke('video:digital-human:resume', requestId, taskId),
      recover: (requestId: string, upstreamTaskId: string, input: DigitalHumanInput) => ipcRenderer.invoke('video:digital-human:recover', requestId, upstreamTaskId, input),
      stop: (requestId: string) => ipcRenderer.invoke('video:digital-human:stop', requestId),
      onProgress: (callback: (payload: DigitalHumanProgress) => void) => { const listener = (_event: Electron.IpcRendererEvent, payload: DigitalHumanProgress) => callback(payload); ipcRenderer.on('video:digital-human:progress', listener); return () => ipcRenderer.removeListener('video:digital-human:progress', listener) }
    },
    personal: {
      audioWorks: () => ipcRenderer.invoke('video:personal:audio-works'),
      selectVideo: () => ipcRenderer.invoke('video:personal:select-video'),
      compose: (requestId: string, input: { videoPath: string; audioWorkId: number; projectId?: number; title?: string }) => ipcRenderer.invoke('video:personal:compose', requestId, input),
      stop: (requestId: string) => ipcRenderer.invoke('video:personal:stop', requestId),
      onProgress: (callback: (payload: DigitalHumanProgress) => void) => { const listener = (_event: Electron.IpcRendererEvent, payload: DigitalHumanProgress) => callback(payload); ipcRenderer.on('video:personal:progress', listener); return () => ipcRenderer.removeListener('video:personal:progress', listener) }
    },
    polish: {
      videoWorks: () => ipcRenderer.invoke('video:polish:video-works'),
      selectVideo: () => ipcRenderer.invoke('video:polish:select-video'),
      selectMusic: () => ipcRenderer.invoke('video:polish:select-music'),
      render: (requestId: string, input: PolishVideoInput) => ipcRenderer.invoke('video:polish:render', requestId, input),
      stop: (requestId: string) => ipcRenderer.invoke('video:polish:stop', requestId),
      onProgress: (callback: (payload: DigitalHumanProgress) => void) => { const listener = (_event: Electron.IpcRendererEvent, payload: DigitalHumanProgress) => callback(payload); ipcRenderer.on('video:polish:progress', listener); return () => ipcRenderer.removeListener('video:polish:progress', listener) }
    },
    asr: { providers: () => ipcRenderer.invoke('video:asr:providers') },
    whisper: {
      status: () => ipcRenderer.invoke('video:whisper:status'),
      download: () => ipcRenderer.invoke('video:whisper:download'),
      installEngine: () => ipcRenderer.invoke('video:whisper:install-engine'),
      selectEngine: () => ipcRenderer.invoke('video:whisper:select-engine'),
      onProgress: (callback: (payload: WhisperProgress) => void) => { const listener = (_event: Electron.IpcRendererEvent, payload: WhisperProgress) => callback(payload); ipcRenderer.on('video:whisper:progress', listener); return () => ipcRenderer.removeListener('video:whisper:progress', listener) }
    }
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name: string, description?: string) => ipcRenderer.invoke('projects:create', name, description),
    update: (id: number, name: string, description?: string) => ipcRenderer.invoke('projects:update', id, name, description),
    delete: (id: number) => ipcRenderer.invoke('projects:delete', id)
  },
  tasks: {
    list: (projectId: number) => ipcRenderer.invoke('tasks:list', projectId),
    create: (projectId: number, title: string, schedule?: string) => ipcRenderer.invoke('tasks:create', projectId, title, schedule),
    update: (id: number, title: string, schedule: string, status: string, enabled?: boolean) => ipcRenderer.invoke('tasks:update', id, title, schedule, status, enabled),
    delete: (id: number) => ipcRenderer.invoke('tasks:delete', id),
    runs: (projectId: number) => ipcRenderer.invoke('tasks:runs', projectId),
    run: (id: number, title?: string) => ipcRenderer.invoke('tasks:run', id, title),
    onUpdated: (callback: (taskId: number) => void) => { const listener = (_event: Electron.IpcRendererEvent, taskId: number) => callback(taskId); ipcRenderer.on('tasks:updated', listener); return () => ipcRenderer.removeListener('tasks:updated', listener) }
  },
  modelConfig: {
    get: (provider: string) => ipcRenderer.invoke('model-config:get', provider),
    save: (config: ModelConfigInput, apiKey?: string) => ipcRenderer.invoke('model-config:save', config, apiKey),
    test: (config: ModelConfigInput, apiKey?: string) => ipcRenderer.invoke('model-config:test', config, apiKey)
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    create: (title: string, provider: string, model: string) => ipcRenderer.invoke('conversations:create', title, provider, model),
    update: (id: number, title: string, provider?: string, model?: string) => ipcRenderer.invoke('conversations:update', id, title, provider, model),
    delete: (id: number) => ipcRenderer.invoke('conversations:delete', id),
    messages: (conversationId: number) => ipcRenderer.invoke('messages:list', conversationId)
  },
  chat: {
    providers: () => ipcRenderer.invoke('chat:providers'),
    selectAttachments: () => ipcRenderer.invoke('chat:select-attachments'),
    start: (requestId: string, conversationId: number, prompt: string, provider: string) => ipcRenderer.invoke('chat:start', requestId, conversationId, prompt, provider),
    stop: (requestId: string) => ipcRenderer.invoke('chat:stop', requestId),
    onDelta: (callback: (payload: ChatEvent) => void) => listen('chat:delta', callback),
    onDone: (callback: (payload: ChatEvent) => void) => listen('chat:done', callback),
    onError: (callback: (payload: ChatEvent) => void) => listen('chat:error', callback)
  },
  agent: {
    runs: (conversationId: number) => ipcRenderer.invoke('agent:runs', conversationId),
    start: (requestId: string, conversationId: number, prompt: string, provider: string, permissionMode: AgentPermissionMode) => ipcRenderer.invoke('agent:start', requestId, conversationId, prompt, provider, permissionMode),
    stop: (requestId: string) => ipcRenderer.invoke('agent:stop', requestId),
    respondApproval: (approvalId: string, decision: AgentApprovalDecision) => ipcRenderer.invoke('agent:approval:respond', approvalId, decision),
    onDelta: (callback: (payload: ChatEvent) => void) => listen('agent:delta', callback),
    onDone: (callback: (payload: ChatEvent) => void) => listen('agent:done', callback),
    onError: (callback: (payload: ChatEvent) => void) => listen('agent:error', callback),
    onTool: (callback: (payload: AgentToolEvent) => void) => listen('agent:tool', callback),
    onApproval: (callback: (payload: AgentApprovalPrompt) => void) => listen('agent:approval', callback)
  },
  works: {
    listText: () => ipcRenderer.invoke('works:text:list'),
    saveText: (title: string, content: string, conversationId?: number) => ipcRenderer.invoke('works:text:save', title, content, conversationId),
    list: () => ipcRenderer.invoke('works:list'),
    page: (input: WorksPageInput) => ipcRenderer.invoke('works:page', input),
    byKeys: (keys: string[]) => ipcRenderer.invoke('works:by-keys', keys),
    preview: (type: WorkType, id: number) => ipcRenderer.invoke('works:preview', type, id),
    update: (type: WorkType, id: number, input: { title: string; favorite: boolean; tags: string }) => ipcRenderer.invoke('works:update', type, id, input),
    delete: (type: WorkType, id: number) => ipcRenderer.invoke('works:delete', type, id),
    exportText: (id: number, title: string, content: string) => ipcRenderer.invoke('works:export-text', id, title, content),
    openLocation: (path: string) => ipcRenderer.invoke('works:open-location', path),
    downloadFile: (path: string, title: string) => ipcRenderer.invoke('works:download-file', path, title),
    addProject: (type: WorkType, id: number, projectId: number) => ipcRenderer.invoke('works:add-project', type, id, projectId),
    createTask: (type: WorkType, id: number, projectId: number, title: string) => ipcRenderer.invoke('works:create-task', type, id, projectId, title),
    backup: () => ipcRenderer.invoke('works:backup')
  },
  image: {
    providers: () => ipcRenderer.invoke('image:providers'),
    selectReference: () => ipcRenderer.invoke('image:select-reference'),
    generate: (requestId: string, provider: string, input: ImageGenerationInput) => ipcRenderer.invoke('image:generate', requestId, provider, input),
    stop: (requestId: string) => ipcRenderer.invoke('image:stop', requestId),
    works: () => ipcRenderer.invoke('image:works'),
    download: (id: number) => ipcRenderer.invoke('image:download', id)
  },
  publishing: {
    accounts: {
      list: () => ipcRenderer.invoke('publish:accounts:list'),
      create: (input: PublishAccountInput) => ipcRenderer.invoke('publish:accounts:create', input),
      update: (id: number, input: PublishAccountInput & { enabled: boolean }) => ipcRenderer.invoke('publish:accounts:update', id, input),
      delete: (id: number) => ipcRenderer.invoke('publish:accounts:delete', id),
      test: (id: number) => ipcRenderer.invoke('publish:accounts:test', id),
      authorizeBrowser: (id: number, browser: 'edge' | 'chrome') => ipcRenderer.invoke('publish:accounts:authorize-browser', id, browser),
      importCookies: (id: number) => ipcRenderer.invoke('publish:accounts:import-cookies', id),
      clearAuthorization: (id: number) => ipcRenderer.invoke('publish:accounts:clear-auth', id),
      openLogin: (id: number) => ipcRenderer.invoke('publish:accounts:open-login', id)
    },
    list: () => ipcRenderer.invoke('publish:list'),
    create: (input: PublicationInput) => ipcRenderer.invoke('publish:create', input),
    update: (id: number, input: PublicationUpdateInput) => ipcRenderer.invoke('publish:update', id, input),
    validate: (id: number) => ipcRenderer.invoke('publish:validate', id),
    run: (id: number) => ipcRenderer.invoke('publish:run', id),
    cancel: (id: number) => ipcRenderer.invoke('publish:cancel', id),
    retry: (id: number) => ipcRenderer.invoke('publish:retry', id),
    complete: (id: number) => ipcRenderer.invoke('publish:complete', id),
    fail: (id: number) => ipcRenderer.invoke('publish:fail', id),
    copy: (id: number) => ipcRenderer.invoke('publish:copy', id),
    delete: (id: number) => ipcRenderer.invoke('publish:delete', id),
    onUpdated: (callback: (id: number) => void) => { const listener = (_event: Electron.IpcRendererEvent, id: number) => callback(id); ipcRenderer.on('publications:updated', listener); return () => ipcRenderer.removeListener('publications:updated', listener) }
  }
})

type ModelConfigInput = { provider: string; base_url: string; api_protocol: 'responses' | 'chat_completions' | 'claude_messages'; text_model: string; image_model: string; video_model: string; voice_model: string; asr_model: string; default_model: string; temperature: number; max_tokens: number; timeout_seconds: number; retry_count: number }
type ChatEvent = { requestId: string; messageId: number; delta?: string; content?: string; status?: string; error?: string }
type ImageGenerationInput = { prompt: string; style: string; size: string; quality: string; count: number; referencePath?: string }
type PublishAccountInput = { platform: string; name: string; handle: string; simulation: boolean; authMethod?: 'browser'; browser?: 'edge' | 'chrome' }
type PublicationInput = { accountIds: number[]; projectId?: number | null; title: string; body: string; topics: string; status: string; scheduledAt?: string | null; workKeys: string[] }
type PublicationUpdateInput = Omit<PublicationInput, 'accountIds'> & { accountId: number }
type VideoProjectInput = { title: string; mode: string; language: string; targetLength: number; draft: string }
type WhisperProgress = { progress: number; received: number; total: number; phase?: 'downloading' | 'extracting' }
type VideoSourceProgress = { sourceId: number; progress: number; message: string }
type VideoCopyInput = { action: 'generate' | 'legal'; mode: 'breakdown' | 'inspiration' | 'original'; source: string; targetLength: number; language: string; subject?: string; product?: string; audience?: string; platform?: string; style?: string; rewriteStrength?: number; provider?: string }
type WorkType = 'text' | 'image' | 'video' | 'audio'
type DigitalHumanInput = { imagePath: string; text: string; ratio: string; resolution: string; duration: number; motion: string; provider?: string; videoModel?: string; projectId?: number; title?: string }
type DigitalHumanProgress = { requestId: string; progress: number; message: string }
type PolishVideoInput = { sourcePath: string; title?: string; subtitleText?: string; burnSubtitles: boolean; subtitleSize: number; subtitleColor: string; subtitlePosition: 'bottom' | 'center' | 'top'; musicPath?: string; sourceVolume: number; musicVolume: number; ratio: '9:16' | '16:9' | '1:1'; quality: '720p' | '1080p'; trimStart: number; trimEnd: number; projectId?: number }
function listen<T>(channel: string, callback: (payload: T) => void) { const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener) }
