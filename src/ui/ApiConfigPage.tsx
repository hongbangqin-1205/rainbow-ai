import { useEffect, useMemo, useState } from 'react'
import { readAsrEngine, saveAsrEngine, type AsrEngine } from './asrPreferences'

const providers = ['OpenAI', '小米 MiMo', '极客智坊', 'DMXAPI', 'DeepSeek', 'Claude', '通义千问', '豆包', '自定义兼容 API']
const emptyConfig: ModelConfigInput = { provider: 'OpenAI', base_url: '', api_protocol: 'responses', text_model: '', image_model: '', video_model: '', voice_model: '', asr_model: '', default_model: '', temperature: 0.7, max_tokens: 4096, timeout_seconds: 60, retry_count: 2 }
const asrProviderKey = 'rainbow-asr-provider'

export function ApiConfigPage() {
  const [provider, setProvider] = useState('OpenAI')
  const [config, setConfig] = useState<ModelConfigInput>(emptyConfig)
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [asrEngine, setAsrEngine] = useState<AsrEngine>(readAsrEngine)
  const [asrProviders, setAsrProviders] = useState<AsrProviderConfig[]>([])
  const [asrProvider, setAsrProvider] = useState(() => localStorage.getItem(asrProviderKey) || '')
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null)
  const [whisperBusy, setWhisperBusy] = useState<'download' | 'engine' | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadPhase, setDownloadPhase] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setNotice(null); setApiKey(''); setModels([])
    window.electronAPI.modelConfig.get(provider).then((value) => {
      if (!active) return
      const { has_api_key, updated_at: _updatedAt, ...stored } = value
      setConfig(stored); setHasApiKey(has_api_key)
    }).catch((error) => setNotice({ tone: 'error', text: error instanceof Error ? error.message : '配置加载失败' })).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [provider])

  useEffect(() => {
    void Promise.all([window.electronAPI.video.asr.providers(), window.electronAPI.video.whisper.status()]).then(([rows, status]) => {
      setAsrProviders(rows); setWhisper(status)
      const stored = localStorage.getItem(asrProviderKey)
      if (!stored || !rows.some((item) => item.provider === stored)) {
        const first = rows.find((item) => item.configured && item.model)
        if (first) { setAsrProvider(first.provider); localStorage.setItem(asrProviderKey, first.provider) }
      }
    })
    const offProgress = window.electronAPI.video.whisper.onProgress(({ progress, phase }) => {
      setDownloadProgress(progress); setDownloadPhase(phase === 'extracting' ? '正在解压…' : '')
    })
    return offProgress
  }, [])

  const field = <K extends keyof ModelConfigInput>(name: K, value: ModelConfigInput[K]) => setConfig((current) => ({ ...current, [name]: value }))
  async function save() {
    setSaving(true); setNotice(null)
    try { const result = await window.electronAPI.modelConfig.save(config, apiKey || undefined); setHasApiKey(result.has_api_key); setApiKey(''); setAsrProviders(await window.electronAPI.video.asr.providers()); setNotice({ tone: 'success', text: '配置已保存到本机' }) }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存失败' }) }
    finally { setSaving(false) }
  }
  async function testConnection() {
    setTesting(true); setNotice(null); setModels([])
    try { const result = await window.electronAPI.modelConfig.test(config, apiKey || undefined); setModels(result.models); setNotice({ tone: result.ok ? 'success' : 'error', text: result.message }) }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '连接测试失败' }) }
    finally { setTesting(false) }
  }
  function selectAsrEngine(value: AsrEngine) { setAsrEngine(value); saveAsrEngine(value) }
  function selectAsrProvider(value: string) { setAsrProvider(value); localStorage.setItem(asrProviderKey, value) }
  async function downloadWhisper() {
    setWhisperBusy('download'); setDownloadProgress(0); setNotice(null)
    try { setWhisper(await window.electronAPI.video.whisper.download()) }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '模型下载失败' }) }
    finally { setWhisperBusy(null) }
  }
  async function installWhisperEngine() {
    setWhisperBusy('engine'); setDownloadProgress(0); setDownloadPhase(''); setNotice(null)
    try { setWhisper(await window.electronAPI.video.whisper.installEngine()) }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '执行引擎安装失败' }) }
    finally { setWhisperBusy(null); setDownloadPhase('') }
  }

  return <main className="api-page">
    <header className="api-heading"><div><p className="home-kicker">RAINBOW AI · MODEL SETTINGS</p><h1>API 与模型配置</h1><p>连接模型服务，为文本、图片、视频和语音分配能力。</p></div><span className="api-safe">⌾ 系统级加密存储</span></header>
    <nav className="api-provider-tabs" aria-label="模型服务商">{providers.map((item) => <button key={item} className={provider === item ? 'selected' : ''} onClick={() => setProvider(item)}>{item}{provider === item && hasApiKey ? <i>已配置</i> : null}</button>)}</nav>
    {notice && <div className={`api-notice ${notice.tone}`}>{notice.tone === 'success' ? '✓' : notice.tone === 'error' ? '!' : '·'} {notice.text}</div>}
    {(provider === '自定义兼容 API' || provider === '极客智坊' || provider === 'DMXAPI') && <div className="api-relay-note"><strong>{provider === '极客智坊' ? '极客智坊聚合 API' : provider === 'DMXAPI' ? 'DMXAPI 第三方中转' : '第三方中转站'}</strong><span>{provider === 'DMXAPI' ? '已预设 OpenAI 兼容端点 https://www.dmxapi.cn/v1；测试连接后可从当前 Key 的可用模型中选择。' : 'API Key、提示词和生成内容会发送到该服务地址，请确认服务来源可信。语音模型推荐先使用 gpt-4o-mini-tts。'}</span></div>}
    <section className={`api-layout ${loading ? 'is-loading' : ''}`}>
      <div className="api-form panel"><div className="api-section-title"><h2>服务连接</h2><p>API Key 仅加密保存在当前 Windows 用户下</p></div>
        <label><span>服务商</span><select value={provider} onChange={(event) => setProvider(event.target.value)}>{providers.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>API Key</span><div className="api-key-row"><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasApiKey ? '已安全保存；留空则继续使用原 Key' : `输入 ${provider} API Key`} autoComplete="off" /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</button></div></label>
        <label><span>API 地址</span><input value={config.base_url} onChange={(event) => field('base_url', event.target.value)} placeholder="https://api.example.com/v1" /></label>
        {provider === '自定义兼容 API' && <label><span>接口协议</span><select value={config.api_protocol} onChange={(event) => field('api_protocol', event.target.value as ModelConfigInput['api_protocol'])}><option value="chat_completions">OpenAI Chat Completions（常用）</option><option value="responses">OpenAI Responses</option><option value="claude_messages">Claude Messages</option></select></label>}
        <div className="api-actions"><button className="outline-button" disabled={testing || loading} onClick={() => void testConnection()}>{testing ? '正在测试…' : '测试连通性'}</button><button className="gradient-button" disabled={saving || loading} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</button></div>
      </div>
      <div className="api-form panel"><div className="api-section-title"><h2>模型分配</h2><p>模型名称支持直接输入，测试连接后也可从列表选择</p></div>
        <ModelField label="文本模型" value={config.text_model} onChange={(value) => field('text_model', value)} models={models} />
        <ModelField label="图片模型" value={config.image_model} onChange={(value) => field('image_model', value)} models={models} />
        <ModelField label="视频模型" value={config.video_model} onChange={(value) => field('video_model', value)} models={models} />
        <ModelField label="语音模型" value={config.voice_model} onChange={(value) => field('voice_model', value)} models={models} />
        <ModelField label="ASR 转写模型" value={config.asr_model} onChange={(value) => field('asr_model', value)} models={models} />
        <ModelField label="默认模型" value={config.default_model} onChange={(value) => field('default_model', value)} models={models} />
      </div>
    </section>
    <section className="api-asr-settings panel"><div className="api-section-title"><h2>语音转写方式</h2><p>视频创作解析文案时统一使用这里设置的转写引擎</p></div>
      <div className="asr-engine-switch" aria-label="转写引擎"><button className={asrEngine === 'local' ? 'selected' : ''} onClick={() => selectAsrEngine('local')}>本地 Whisper</button><button className={asrEngine === 'api' ? 'selected' : ''} onClick={() => selectAsrEngine('api')}>API ASR</button></div>
      {asrEngine === 'local' ? <><div className="whisper-manager"><div><strong>本地转写 · Whisper small</strong><small>{whisper?.ready ? '模型与执行引擎已就绪' : whisper?.modelReady ? '模型已下载，还需安装执行引擎' : '模型约 466 MB，仅首次使用时下载'}</small></div>{!whisper?.modelReady ? <button disabled={Boolean(whisperBusy)} onClick={() => void downloadWhisper()}>{whisperBusy === 'download' ? `下载中 ${downloadProgress}%` : '下载模型'}</button> : !whisper.engineReady ? <div className="whisper-engine-actions"><button disabled={Boolean(whisperBusy)} onClick={() => void installWhisperEngine()}>{whisperBusy === 'engine' ? downloadPhase || `安装中 ${downloadProgress}%` : '自动安装引擎'}</button><button title="手动选择 whisper-cli.exe" onClick={async () => setWhisper(await window.electronAPI.video.whisper.selectEngine())}>手动</button></div> : <span>✓ 可用</span>}</div>{whisperBusy && <div className="video-progress"><i style={{ width: `${downloadProgress}%` }} /></div>}</> : <div className="api-asr-manager"><div><strong>API 语音转写</strong><small>音轨会上传到所选服务商并按其价格计费</small></div><select value={asrProvider} onChange={(event) => selectAsrProvider(event.target.value)}><option value="">选择 ASR 服务</option>{asrProviders.map((item) => <option key={item.provider} value={item.provider}>{item.provider} · {item.model || '未设置模型'}{item.configured ? '' : '（未配置 Key）'}</option>)}</select></div>}
    </section>
    <section className="api-advanced panel"><div className="api-section-title"><h2>运行参数</h2><p>这些参数会作为该服务商的默认请求策略</p></div><div className="api-parameter-grid">
      <NumberField label="温度" value={config.temperature} min={0} max={2} step={0.1} onChange={(value) => field('temperature', value)} />
      <NumberField label="最大 Token" value={config.max_tokens} min={1} max={200000} onChange={(value) => field('max_tokens', value)} />
      <NumberField label="超时时间（秒）" value={config.timeout_seconds} min={5} max={300} onChange={(value) => field('timeout_seconds', value)} />
      <NumberField label="失败重试次数" value={config.retry_count} min={0} max={5} onChange={(value) => field('retry_count', value)} />
    </div></section>
  </main>
}

function ModelField({ label, value, onChange, models }: { label: string; value: string; onChange: (value: string) => void; models: string[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? models.filter((model) => model.toLowerCase().includes(normalized)) : models
  }, [models, query])
  const choose = (model: string) => { onChange(model); setQuery(''); setOpen(false); setActive(0) }
  return <label className="model-field"><span>{label}</span><div className="model-combobox">
    <input value={value} onFocus={() => { setOpen(Boolean(models.length)); setQuery(''); setActive(0) }} onChange={(event) => { onChange(event.target.value); setQuery(event.target.value); setOpen(Boolean(models.length)); setActive(0) }} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) { setOpen(Boolean(models.length)); return }; if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, visible.length - 1)) }; if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }; if (event.key === 'Enter' && visible[active]) { event.preventDefault(); choose(visible[active]) }; if (event.key === 'Escape') setOpen(false) }} placeholder={`输入${label}名称`} autoComplete="off" aria-expanded={open} />
    <button type="button" className="model-combobox-toggle" title="展开模型列表" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen((current) => !current); setQuery(''); setActive(0) }}>⌄</button>
    {open && <div className="model-options" role="listbox" onMouseDown={(event) => event.preventDefault()} onWheel={(event) => event.stopPropagation()}><header><span>{query ? `筛选到 ${visible.length} 个` : `全部 ${models.length} 个模型`}</span>{query && <button type="button" onClick={() => { setQuery(''); onChange('') }}>清除筛选</button>}</header>{visible.length ? visible.map((model, index) => <button type="button" role="option" aria-selected={model === value} key={model} className={`${index === active ? 'active' : ''} ${model === value ? 'selected' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(model)}>{model}</button>) : <p>没有匹配的模型，也可以直接输入模型 ID。</p>}</div>}
  </div></label>
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>
}
