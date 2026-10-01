import { useEffect, useMemo, useState } from 'react'

const styles = ['自动', '摄影写实', '电影感', '极简设计', '插画', '3D 渲染', '国风']
type SizeOption = { value: string; label: string }

function sizesForModel(model = ''): { options: SizeOption[]; note: string } {
  const name = model.toLowerCase()
  if (name.includes('dall-e-3') || name.includes('dalle-3')) return { options: [{ value: '1024x1024', label: '1:1 方形' }, { value: '1792x1024', label: '7:4 横版' }, { value: '1024x1792', label: '4:7 竖版' }], note: '已适配 DALL·E 3' }
  if (name.includes('dall-e-2') || name.includes('dalle-2')) return { options: [{ value: '256x256', label: '1:1 小图' }, { value: '512x512', label: '1:1 中图' }, { value: '1024x1024', label: '1:1 高清' }], note: '已适配 DALL·E 2' }
  if (name.includes('gpt-image')) return { options: [{ value: 'auto', label: '自动（模型决定）' }, { value: '1024x1024', label: '1:1 方形' }, { value: '1536x1024', label: '3:2 横版' }, { value: '1024x1536', label: '2:3 竖版' }, { value: 'custom', label: '自定义尺寸' }], note: '已适配 GPT Image' }
  return { options: [{ value: 'auto', label: '自动（推荐）' }, { value: 'custom', label: '自定义尺寸' }], note: model ? '未知模型由服务端自动决定' : '设置图片模型后自动适配' }
}

export function ImageStudioPage({ recreate }: { recreate?: RecreatePayload }) {
  const [providers, setProviders] = useState<ImageProviderConfig[]>([])
  const [provider, setProvider] = useState('OpenAI')
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('自动')
  const [size, setSize] = useState('auto')
  const [customSize, setCustomSize] = useState('1024x1024')
  const [quality, setQuality] = useState('medium')
  const [count, setCount] = useState(1)
  const [reference, setReference] = useState<{ path: string; name: string; data_url: string } | null>(null)
  const [works, setWorks] = useState<ImageWork[]>([])
  const [results, setResults] = useState<ImageWork[]>([])
  const [selected, setSelected] = useState<ImageWork | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(true)

  const currentProvider = providers.find((item) => item.provider === provider)
  const sizeCapabilities = useMemo(() => sizesForModel(currentProvider?.model), [currentProvider?.model])
  const generating = Boolean(requestId)
  const displayItems = results.length ? results : works
  const availableCount = useMemo(() => providers.filter((item) => item.configured && item.model).length, [providers])

  useEffect(() => {
    Promise.all([window.electronAPI.image.providers(), window.electronAPI.image.works()]).then(([providerRows, workRows]) => {
      setProviders(providerRows); setWorks(workRows)
      const first = providerRows.find((item) => item.configured && item.model) ?? providerRows[0]
      if (first) setProvider(first.provider)
      if (recreate?.provider && providerRows.some((item) => item.provider === recreate.provider)) setProvider(recreate.provider)
      if (recreate?.prompt) setPrompt(recreate.prompt)
      if (recreate?.quality) setQuality(recreate.quality)
      if (recreate?.size) { const known = sizesForModel(providerRows.find((item) => item.provider === recreate.provider)?.model).options.some((item) => item.value === recreate.size); if (known) setSize(recreate.size); else { setSize('custom'); setCustomSize(recreate.size) } }
      if (workRows[0]) setSelected(workRows[0])
    }).catch((error) => setNotice(error instanceof Error ? error.message : '图片工作台加载失败'))
  }, [recreate])

  useEffect(() => {
    if (!sizeCapabilities.options.some((item) => item.value === size)) setSize(sizeCapabilities.options[0]?.value ?? 'auto')
  }, [provider, sizeCapabilities, size])

  async function chooseReference() {
    try { const value = await window.electronAPI.image.selectReference(); if (value) setReference(value) }
    catch (error) { setNotice(error instanceof Error ? error.message : '参考图片读取失败') }
  }

  async function generate() {
    const text = prompt.trim()
    if (!text || generating) return
    if (!currentProvider?.configured) { setNotice(`请先在“API 与模型”中配置 ${provider} API Key`); return }
    if (!currentProvider.model) { setNotice(`请先为 ${provider} 设置图片模型`); return }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setRequestId(id); setNotice('')
    try {
      const requestedSize = size === 'custom' ? customSize.trim() : size
      if (size === 'custom' && !/^\d{2,4}x\d{2,4}$/.test(requestedSize)) { setNotice('自定义尺寸格式应为“宽x高”，例如 1024x1024'); setRequestId(null); return }
      const generated = await window.electronAPI.image.generate(id, provider, { prompt: text, style, size: requestedSize, quality, count, referencePath: reference?.path })
      setResults(generated); setSelected(generated[0] ?? null)
      setWorks((current) => [...generated, ...current])
      setNotice(`已生成并保存 ${generated.length} 张图片`)
    } catch (error) { setNotice(error instanceof Error ? error.message : '图片生成失败') }
    finally { setRequestId(null) }
  }

  async function stop() { if (requestId) await window.electronAPI.image.stop(requestId) }
  async function download(item: ImageWork) { const saved = await window.electronAPI.image.download(item.id); if (saved) setNotice('图片已导出') }

  return <main className="image-studio-page">
    <header className="image-studio-heading"><div><p className="home-kicker">RAINBOW AI · IMAGE STUDIO</p><h1>图片创作</h1><p>从灵感描述到可用画面，生成结果自动保存到本地。</p></div><div className="image-model-state"><i className={currentProvider?.configured && currentProvider.model ? 'ready' : ''} /><span>{currentProvider?.configured && currentProvider.model ? `${provider} · ${currentProvider.model}` : '图片模型未配置'}</span></div></header>
    {notice && <div className={`image-notice ${notice.startsWith('已') ? 'success' : ''}`}><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
    <section className="image-workspace">
      <div className="image-control-panel panel">
        <div className="image-panel-title"><div><span>CREATE</span><h2>创作设置</h2></div><button onClick={() => setSettingsOpen((value) => !value)}>{settingsOpen ? '−' : '+'}</button></div>
        <label className="image-prompt-field"><span>画面描述</span><textarea value={prompt} disabled={generating} onChange={(event) => setPrompt(event.target.value)} placeholder="描述主体、场景、光线、构图和氛围…" /><small>{prompt.length} 字</small></label>
        <div className="image-reference"><div className="image-field-label"><span>参考图片</span><small>可选，用于风格或内容参考</small></div>{reference ? <div className="reference-preview"><img src={reference.data_url} alt={reference.name} /><div><strong>{reference.name}</strong><small>将调用图片编辑接口</small></div><button onClick={() => setReference(null)}>×</button></div> : <button className="reference-empty" onClick={() => void chooseReference()}><b>＋</b><span>添加参考图片</span></button>}</div>
        {settingsOpen && <div className="image-settings-grid">
          <label><span>模型服务</span><select value={provider} disabled={generating} onChange={(event) => setProvider(event.target.value)}>{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider}{item.configured && item.model ? ` · ${item.model}` : '（未配置）'}</option>)}</select></label>
          <label><span>画面比例 <small className="image-size-note">{sizeCapabilities.note}</small></span><select value={size} onChange={(event) => setSize(event.target.value)}>{sizeCapabilities.options.map((item) => <option key={item.value} value={item.value}>{item.label}{item.value !== 'auto' && item.value !== 'custom' ? ` · ${item.value}` : ''}</option>)}</select>{size === 'custom' && <input className="image-custom-size" value={customSize} onChange={(event) => setCustomSize(event.target.value)} placeholder="例如 1280x720" />}</label>
          <label><span>生成质量</span><select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="low">快速</option><option value="medium">标准</option><option value="high">精细</option></select></label>
          <label><span>生成数量</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={4}>4 张</option></select></label>
        </div>}
        <div className="image-style-field"><span>视觉风格</span><div>{styles.map((item) => <button key={item} className={style === item ? 'selected' : ''} onClick={() => setStyle(item)}>{item}</button>)}</div></div>
        <div className="image-generate-row"><small>{availableCount ? `${availableCount} 个图片服务可用` : '请先配置图片模型'}</small>{generating ? <button className="image-stop" onClick={() => void stop()}>■ 停止生成</button> : <button className="gradient-button" disabled={!prompt.trim()} onClick={() => void generate()}>生成图片　✦</button>}</div>
      </div>
      <div className="image-preview-panel panel">
        <div className="image-preview-header"><div><span>PREVIEW</span><h2>{generating ? '正在创作' : selected ? '生成结果' : '画布预览'}</h2></div>{selected && <button className="outline-button" onClick={() => void download(selected)}>↓ 导出图片</button>}</div>
        <div className={`image-stage ${generating ? 'generating' : ''}`}>{generating ? <div className="image-loading"><div className="rainbow-loader"><i /><i /><i /></div><strong>Rainbow AI 正在绘制</strong><span>图片生成通常需要几十秒</span></div> : selected?.data_url ? <img src={selected.data_url} alt={selected.prompt} /> : <div className="image-empty-stage"><div>◇</div><strong>从一句描述开始</strong><span>生成后的图片将在这里显示</span></div>}</div>
        {selected && <div className="image-result-meta"><div><strong>{selected.prompt}</strong><span>{selected.provider} · {selected.model} · {selected.size} · {selected.quality}</span></div><button onClick={() => { setPrompt(selected.prompt); setResults([]) }}>再次创作</button></div>}
      </div>
    </section>
    {displayItems.length > 0 && <section className="image-gallery panel"><div className="image-gallery-title"><div><p className="home-kicker">LOCAL WORKS</p><h2>{results.length ? '本次生成' : '最近作品'}</h2></div>{results.length > 0 && <button onClick={() => setResults([])}>查看全部作品</button>}</div><div className="image-gallery-grid">{displayItems.slice(0, 8).map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)}><img src={item.data_url} alt={item.prompt} /><span>{item.prompt}</span><small>{new Date(item.created_at).toLocaleDateString('zh-CN')}</small></button>)}</div></section>}
  </main>
}
