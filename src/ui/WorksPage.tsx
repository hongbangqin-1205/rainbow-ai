import { useEffect, useState } from 'react'
import { AppDialog, useAppDialog } from './AppDialog'

type Props = { onRecreate: (payload: RecreatePayload) => void; onPublish: (key: string) => void }
type Kind = 'all' | WorkType
type View = 'grid' | 'list'
type LinkMode = 'project' | 'task'

const kindLabels: Record<Kind, string> = { all: '全部', text: '文本', image: '图片', video: '视频', audio: '音频' }
const emptyCounts: WorksPageResult['counts'] = { all: 0, text: 0, image: 0, video: 0, audio: 0 }

export function WorksPage({ onRecreate, onPublish }: Props) {
  const appDialog = useAppDialog()
  const [works, setWorks] = useState<UnifiedWork[]>([])
  const [projects, setProjects] = useState<RainbowProject[]>([])
  const [counts, setCounts] = useState(emptyCounts)
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [latest, setLatest] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [model, setModel] = useState('all')
  const [time, setTime] = useState('all')
  const [view, setView] = useState<View>('grid')
  const [selected, setSelected] = useState<UnifiedWork | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState<{ root: string; customized: boolean; defaultRoot: string } | null>(null)
  const [editTarget, setEditTarget] = useState<UnifiedWork | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editTags, setEditTags] = useState('')
  const [linkTarget, setLinkTarget] = useState<UnifiedWork | null>(null)
  const [linkMode, setLinkMode] = useState<LinkMode>('project')
  const [linkProjectId, setLinkProjectId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')

  const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  async function loadPage(targetPage = page) {
    setLoading(true)
    try {
      const result = await window.electronAPI.works.page({ page: targetPage, pageSize, kind, query, provider: provider === 'all' ? '' : provider, model: model === 'all' ? '' : model, time })
      setWorks(result.items); setTotal(result.total); setCounts(result.counts); setProviders(result.providers); setModels(result.models); setLatest(result.latest); setPage(result.page); setChecked(new Set())
    } catch (error) { setNotice(error instanceof Error ? error.message : '作品加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void Promise.all([window.electronAPI.projects.list(), window.electronAPI.storage.status()]).then(([projectRows, storageStatus]) => { setProjects(projectRows); setStorage(storageStatus) }) }, [])
  useEffect(() => { const timer = window.setTimeout(() => void loadPage(1), 180); return () => window.clearTimeout(timer) }, [kind, query, provider, model, time])

  async function openPreview(item: UnifiedWork) {
    setSelected(item)
    if (item.type !== 'text' && !item.missing) { const full = await window.electronAPI.works.preview(item.type, item.id); if (full) setSelected(full) }
  }
  function openEdit(item: UnifiedWork) { setEditTarget(item); setEditTitle(item.title); setEditTags(item.tags) }
  async function saveEdit() {
    if (!editTarget || !editTitle.trim()) return
    await window.electronAPI.works.update(editTarget.type, editTarget.id, { title: editTitle.trim(), tags: editTags.trim(), favorite: Boolean(editTarget.favorite) })
    setEditTarget(null); await loadPage(); setNotice('作品信息已更新')
  }
  async function favorite(item: UnifiedWork) { await window.electronAPI.works.update(item.type, item.id, { title: item.title, tags: item.tags, favorite: !item.favorite }); await loadPage() }
  async function remove(items: UnifiedWork[]) {
    if (!items.length) return
    const confirmed = await appDialog.confirm({ title: items.length > 1 ? '批量删除作品' : '删除作品', message: `确定删除选中的 ${items.length} 个作品吗？图片、音频和视频对应的本地文件也会同步删除，此操作无法撤销。`, confirmLabel: '确认删除', tone: 'danger' })
    if (!confirmed) return
    await Promise.all(items.map((item) => window.electronAPI.works.delete(item.type, item.id))); setSelected(null); await loadPage(Math.min(page, Math.max(1, Math.ceil((total - items.length) / pageSize)))); setNotice(`已删除 ${items.length} 个作品`)
  }
  function openLink(item: UnifiedWork, mode: LinkMode) {
    if (!projects.length) { setNotice('请先在“项目空间”创建项目'); return }
    setLinkTarget(item); setLinkMode(mode); setLinkProjectId(String(projects[0].id)); setTaskTitle(`继续完善：${item.title}`)
  }
  async function saveLink() {
    if (!linkTarget || !linkProjectId) return
    const project = projects.find((item) => item.id === Number(linkProjectId)); if (!project) return
    if (linkMode === 'project') { await window.electronAPI.works.addProject(linkTarget.type, linkTarget.id, project.id); setNotice(`已加入项目“${project.name}”`) }
    else { if (!taskTitle.trim()) return; await window.electronAPI.works.createTask(linkTarget.type, linkTarget.id, project.id, taskTitle.trim()); setNotice('后续任务已创建并记录作品来源') }
    setLinkTarget(null); await loadPage()
  }
  async function backup() { const path = await window.electronAPI.works.backup(); if (path) setNotice(`备份已保存到：${path}`) }
  async function chooseStorage() {
    const confirmed = await appDialog.confirm({ title: '迁移作品存储位置', message: '迁移会复制数据库、图片、旁白和视频资源到新位置，并自动重启软件。原位置会保留作为安全副本。', confirmLabel: '选择新位置' })
    if (!confirmed) return
    setNotice('正在迁移作品数据，请不要关闭软件…')
    try { const result = await window.electronAPI.storage.choose(); if (result) { setStorage(result); setNotice(`迁移完成，软件即将重启：${result.root}`) } else setNotice('已取消迁移') }
    catch (error) { setNotice(error instanceof Error ? error.message : '迁移失败') }
  }

  return <main className="works-page">
    <header className="works-heading"><div><p className="home-kicker">RAINBOW AI · CREATIVE LIBRARY</p><h1>我的作品</h1><p>统一整理每一次创作，让灵感随时可以再次出发。</p></div><div className="works-summary"><strong>{counts.all}</strong><span>件作品</span><small>{latest ? `最近更新 ${formatDate(latest)}` : '还没有作品'}</small></div></header>
    {notice && <div className="works-notice"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
    <section className="works-toolbar panel"><div className="works-kinds">{(['all', 'text', 'image', 'video', 'audio'] as Kind[]).map((item) => <button key={item} className={kind === item ? 'selected' : ''} onClick={() => setKind(item)}>{kindLabels[item]} <b>{counts[item]}</b></button>)}</div><div className="works-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品名称、提示词或标签" /></div><select value={time} onChange={(event) => setTime(event.target.value)}><option value="all">全部时间</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option></select><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">全部服务商</option>{providers.map((item) => <option key={item}>{item}</option>)}</select><select value={model} onChange={(event) => setModel(event.target.value)}><option value="all">全部模型</option>{models.map((item) => <option key={item}>{item}</option>)}</select><div className="view-switch"><button className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}>▦</button><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>☷</button></div></section>
    <section className="works-utility panel"><div className="works-result-count"><strong>{total}</strong><span>件匹配作品{checked.size ? ` · 本页已选择 ${checked.size} 件` : ''}</span></div><div className="works-storage-inline"><small>存储位置</small><span title={storage?.root}>{storage?.root || '正在读取…'}</span><button onClick={() => void chooseStorage()}>更改</button></div><button onClick={() => void backup()}>备份作品</button>{checked.size > 0 && <button className="danger" onClick={() => void remove(works.filter((item) => checked.has(item.key)))}>批量删除</button>}</section>
    {loading ? <div className="works-empty panel">正在读取本地作品…</div> : works.length ? <section className={`works-collection ${view}`}>{works.map((item) => <article key={item.key} className={`work-card panel ${item.missing ? 'missing' : ''}`} onDoubleClick={() => void openPreview(item)}>
      <label className="work-check"><input type="checkbox" checked={checked.has(item.key)} onChange={(event) => setChecked((current) => { const next = new Set(current); event.target.checked ? next.add(item.key) : next.delete(item.key); return next })} /><span /></label><button className="work-favorite" title="收藏" onClick={() => void favorite(item)}>{item.favorite ? '★' : '☆'}</button>
      <button className="work-preview" onClick={() => void openPreview(item)}>{item.type === 'image' ? (item.data_url ? <img src={item.data_url} alt={item.title} loading="lazy" /> : <div className="work-missing">图片文件已丢失</div>) : item.type === 'video' ? (item.missing ? <div className="work-missing">视频文件已丢失</div> : <div className="video-thumb"><b>▶</b><span>VIDEO</span></div>) : item.type === 'audio' ? (item.missing ? <div className="work-missing">音频文件已丢失</div> : <div className="audio-thumb"><b>♫</b><span>AUDIO</span></div>) : <div className="text-thumb"><span>TEXT</span><p>{item.content}</p></div>}</button>
      <div className="work-copy"><div><span className={`work-type ${item.type}`}>{kindLabels[item.type]}</span><small>{formatDate(item.created_at)}</small></div><h3>{item.title}</h3><p>{item.prompt}</p><div className="work-tags">{item.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => <i key={tag}>#{tag.trim()}</i>)}</div><footer><span>{item.provider || '本地'}{item.model ? ` · ${item.model}` : ''}</span><button onClick={() => openEdit(item)}>•••</button></footer></div>
    </article>)}</section> : <div className="works-empty panel"><div>◇</div><h2>没有找到作品</h2><p>调整分类或筛选条件，或者先去完成一次创作。</p></div>}
    {totalPages > 1 && <nav className="works-pagination" aria-label="作品分页"><button disabled={page <= 1 || loading} onClick={() => void loadPage(page - 1)}>← 上一页</button><span>第 <b>{page}</b> / {totalPages} 页</span><button disabled={page >= totalPages || loading} onClick={() => void loadPage(page + 1)}>下一页 →</button></nav>}

    {selected && <div className="work-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><section className="work-modal panel"><header><div><span className={`work-type ${selected.type}`}>{kindLabels[selected.type]}作品</span><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)}>×</button></header><div className="work-modal-body"><div className="work-modal-preview">{selected.type === 'image' ? (selected.data_url ? <img src={selected.data_url} alt={selected.title} /> : <div className="work-missing">无法找到本地图片文件</div>) : selected.type === 'video' ? (selected.data_url ? <video controls src={selected.data_url} /> : <div className="work-missing">无法找到本地视频文件</div>) : selected.type === 'audio' ? (selected.data_url ? <audio controls src={selected.data_url} /> : <div className="work-missing">无法找到本地音频文件</div>) : <pre>{selected.content}</pre>}</div><aside><h3>创作信息</h3><dl><dt>原始提示词</dt><dd>{selected.prompt || '未记录'}</dd><dt>服务商 / 模型</dt><dd>{selected.provider || '未记录'}{selected.model ? ` / ${selected.model}` : ''}</dd>{selected.type === 'image' && <><dt>生成参数</dt><dd>{selected.size} · {selected.quality}</dd></>}{selected.type === 'video' && <><dt>视频参数</dt><dd>{selected.size} · {selected.quality}</dd></>}{selected.type === 'audio' && <><dt>音色 / 语速</dt><dd>{selected.size || '未记录'} · {selected.quality || '1'}x</dd></>}<dt>创建时间</dt><dd>{formatDate(selected.created_at)}</dd><dt>关联项目</dt><dd>{selected.project_ids ? projects.filter((project) => selected.project_ids.split(',').includes(String(project.id))).map((project) => project.name).join('、') : '暂未关联'}</dd></dl></aside></div><footer className="work-modal-actions"><button onClick={() => openEdit(selected)}>重命名与标签</button><button onClick={() => openLink(selected, 'project')}>加入项目</button><button onClick={() => openLink(selected, 'task')}>创建后续任务</button>{selected.type === 'text' ? <><button onClick={() => void navigator.clipboard.writeText(selected.content)}>复制文本</button><button onClick={() => void window.electronAPI.works.exportText(selected.id, selected.title, selected.content)}>导出</button></> : <><button disabled={Boolean(selected.missing)} onClick={() => void (selected.type === 'image' ? window.electronAPI.image.download(selected.id) : window.electronAPI.works.downloadFile(selected.file_path, selected.title))}>下载</button><button disabled={Boolean(selected.missing)} onClick={() => void window.electronAPI.works.openLocation(selected.file_path)}>打开位置</button></>}{selected.type !== 'audio' && <button onClick={() => onPublish(selected.key)}>用于发布</button>}{(selected.type === 'text' || selected.type === 'image') && <button className="primary" onClick={() => onRecreate({ type: selected.type, prompt: selected.prompt, provider: selected.provider, size: selected.size, quality: selected.quality, conversationId: selected.conversation_id })}>再次创作</button>}<button className="danger" onClick={() => void remove([selected])}>删除</button></footer></section></div>}

    {editTarget && <div className="project-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditTarget(null) }}><section className="works-edit-drawer panel" role="dialog" aria-modal="true"><header><div><p className="home-kicker">EDIT WORK</p><h2>编辑作品信息</h2><span>统一修改名称与检索标签</span></div><button onClick={() => setEditTarget(null)}>×</button></header><label><span>作品名称</span><input autoFocus value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label><span>标签</span><input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="多个标签用逗号分隔" /><small>例如：品牌、短视频、待发布</small></label><footer><button onClick={() => setEditTarget(null)}>取消</button><button className="gradient-button" disabled={!editTitle.trim()} onClick={() => void saveEdit()}>保存修改</button></footer></section></div>}
    {linkTarget && <div className="project-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLinkTarget(null) }}><section className="works-project-picker panel" role="dialog" aria-modal="true"><header><div><p className="home-kicker">{linkMode === 'project' ? 'ADD TO PROJECT' : 'CREATE TASK'}</p><h2>{linkMode === 'project' ? '加入项目' : '创建后续任务'}</h2><span>{linkTarget.title}</span></div><button onClick={() => setLinkTarget(null)}>×</button></header><div className="works-project-options">{projects.map((project) => <label key={project.id} className={linkProjectId === String(project.id) ? 'selected' : ''}><input type="radio" name="work-project" value={project.id} checked={linkProjectId === String(project.id)} onChange={(event) => setLinkProjectId(event.target.value)} /><span><b>{project.name}</b><small>{project.description || '暂无项目说明'}</small></span></label>)}</div>{linkMode === 'task' && <label className="works-task-title"><span>任务名称</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label>}<footer><button onClick={() => setLinkTarget(null)}>取消</button><button className="gradient-button" disabled={!linkProjectId || (linkMode === 'task' && !taskTitle.trim())} onClick={() => void saveLink()}>{linkMode === 'project' ? '确认加入' : '创建任务'}</button></footer></section></div>}
    <AppDialog controller={appDialog} />
  </main>
}
