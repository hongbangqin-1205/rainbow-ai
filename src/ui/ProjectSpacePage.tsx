import { useEffect, useMemo, useState } from 'react'
import { AppDialog, useAppDialog } from './AppDialog'

export function ProjectSpacePage() {
  const appDialog = useAppDialog()
  const [activeProject, setActiveProject] = useState<RainbowProject | undefined>()
  const [projects, setProjects] = useState<RainbowProject[]>([])
  const [tasks, setTasks] = useState<RainbowTask[]>([])
  const [runs, setRuns] = useState<RainbowRun[]>([])
  const [linkedWorks, setLinkedWorks] = useState<UnifiedWork[]>([])
  const [editingProject, setEditingProject] = useState<RainbowProject | undefined>()
  const [editingTask, setEditingTask] = useState<RainbowTask | undefined>()
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSchedule, setTaskSchedule] = useState('手动执行')
  const [taskStatus, setTaskStatus] = useState('待执行')
  const [taskEnabled, setTaskEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.projects?.list) { setLoading(false); setLoadError('本地数据库接口未加载，请重启 Rainbow AI'); return }
    void api.projects.list().then((items) => { setProjects(items); setActiveProject(items[0]); setLoading(false) }).catch((error: unknown) => { setLoading(false); setLoadError(error instanceof Error ? error.message : '项目数据加载失败') })
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (activeProject && api?.tasks?.list) void Promise.all([api.tasks.list(activeProject.id), api.tasks.runs(activeProject.id), api.works.page({ page: 1, pageSize: 60, kind: 'all', projectId: activeProject.id })]).then(([taskItems, runItems, workResult]) => { setTasks(taskItems); setRuns(runItems); setLinkedWorks(workResult.items) }).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : '任务数据加载失败'))
    else { setTasks([]); setRuns([]); setLinkedWorks([]) }
  }, [activeProject])

  useEffect(() => {
    if (!activeProject || !window.electronAPI.tasks.onUpdated) return
    return window.electronAPI.tasks.onUpdated(() => { void Promise.all([window.electronAPI.tasks.list(activeProject.id), window.electronAPI.tasks.runs(activeProject.id)]).then(([taskItems, runItems]) => { setTasks(taskItems); setRuns(runItems) }) })
  }, [activeProject])

  const progress = useMemo(() => tasks.length ? Math.round(tasks.filter((task) => task.status === '已完成').length / tasks.length * 100) : 0, [tasks])

  function openNewProject() { setEditingProject(undefined); setProjectName(''); setProjectDescription(''); setShowProjectModal(true) }
  function openEditProject() { if (!activeProject) return; setEditingProject(activeProject); setProjectName(activeProject.name); setProjectDescription(activeProject.description); setShowProjectModal(true) }
  function openNewTask() { setEditingTask(undefined); setTaskTitle(''); setTaskSchedule('手动执行'); setTaskStatus('待执行'); setTaskEnabled(true); setShowTaskModal(true) }
  function openEditTask(task: RainbowTask) { setEditingTask(task); setTaskTitle(task.title); setTaskSchedule(task.schedule); setTaskStatus(task.status); setTaskEnabled(Boolean(task.enabled)); setShowTaskModal(true) }

  async function saveProject() {
    if (!projectName.trim()) return
    try {
      if (editingProject) {
        const project = await window.electronAPI.projects.update(editingProject.id, projectName.trim(), projectDescription.trim())
        setProjects((current) => current.map((item) => item.id === project.id ? project : item)); setActiveProject(project)
      } else {
        const project = await window.electronAPI.projects.create(projectName.trim(), projectDescription.trim())
        setProjects((current) => [...current, project]); setActiveProject(project)
      }
      setShowProjectModal(false); setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : '项目保存失败') }
  }

  async function saveTask() {
    if (!activeProject || !taskTitle.trim()) return
    try {
      if (editingTask) {
        const task = await window.electronAPI.tasks.update(editingTask.id, taskTitle.trim(), taskSchedule, taskStatus, taskEnabled)
        setTasks((current) => current.map((item) => item.id === task.id ? task : item))
      } else {
        const task = await window.electronAPI.tasks.create(activeProject.id, taskTitle.trim(), taskSchedule)
        setTasks((current) => [...current, task])
      }
      setShowTaskModal(false); setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : '任务保存失败') }
  }

  async function deleteProject(project: RainbowProject) {
    const confirmed = await appDialog.confirm({ title: '删除项目', message: `确定删除项目“${project.name}”吗？项目下的任务记录也会一并移除。`, confirmLabel: '删除项目', tone: 'danger' }); if (!confirmed) return
    await window.electronAPI.projects.delete(project.id)
    const remaining = projects.filter((item) => item.id !== project.id)
    setProjects(remaining); setActiveProject(remaining[0])
  }

  async function deleteTask(task: RainbowTask) {
    const confirmed = await appDialog.confirm({ title: '删除任务', message: `确定删除任务“${task.title}”吗？`, confirmLabel: '删除任务', tone: 'danger' }); if (!confirmed) return
    await window.electronAPI.tasks.delete(task.id)
    setTasks((current) => current.filter((item) => item.id !== task.id))
  }

  async function runTask(id: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status: '执行中' } : task))
    const current = tasks.find((task) => task.id === id)
    await window.electronAPI.tasks.run(id, current?.title)
    if (activeProject) setTasks(await window.electronAPI.tasks.list(activeProject.id))
  }

  async function toggleTask(task: RainbowTask) {
    const updated = await window.electronAPI.tasks.update(task.id, task.title, task.schedule, task.status, !task.enabled)
    setTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  const tone = (status: string) => status === '已完成' ? 'green' : status === '执行中' ? 'violet' : 'gray'
  const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '无计划'

  return <main className="project-page">
    <header className="project-heading"><div><p className="home-kicker">RAINBOW AI · PROJECT SPACE</p><h1>项目空间</h1><p>把创作拆成任务，让内容按计划自动完成。</p></div><button className="gradient-button" onClick={openNewProject}>＋ 新建项目</button></header>
    {loadError && <div className="project-error">项目数据暂时无法加载：{loadError}</div>}
    {loading ? <div className="project-loading panel">正在加载项目...</div> : <div className="project-layout">
      <aside className="project-list panel"><div className="project-list-title"><h2>我的项目</h2><span>{projects.length}</span></div>{projects.map((project) => <div key={project.id} className={`project-item ${activeProject?.id === project.id ? 'selected' : ''}`}><button className="project-select" onClick={() => setActiveProject(project)}><span className="project-dot" />{project.name}</button><button className="project-remove" title={`删除${project.name}`} onClick={() => void deleteProject(project)}>×</button></div>)}{projects.length === 0 && <div className="project-list-empty">暂无项目</div>}<button className="add-project" onClick={openNewProject}>＋ 添加项目</button></aside>
      <section className="project-main">
        <div className="project-overview panel"><div><span className="project-label">当前项目</span><div className="project-name-row"><h2>{activeProject?.name || '暂无项目'}</h2>{activeProject && <button className="project-edit" onClick={openEditProject}>编辑</button>}</div><p>{activeProject?.description || '创建项目后开始安排任务。'}</p></div><div className="project-progress"><strong>{progress}%</strong><span>本周进度</span><div><i style={{ width: `${progress}%` }} /></div><small>{tasks.filter((task) => task.status === '已完成').length}/{tasks.length} 个任务完成</small></div></div>
        <div className="project-tasks panel"><div className="section-title"><div><h2>任务计划</h2><p>可以为每一条任务设置执行时间</p></div><button className="outline-button" onClick={openNewTask} disabled={!activeProject}>＋ 添加任务</button></div><div className="task-timeline">{tasks.map((item, index) => <div className={`project-task ${item.enabled ? '' : 'paused'}`} key={item.id}><span className={`task-index ${tone(item.status)}`}>{String(index + 1).padStart(2, '0')}</span><div className="task-content"><strong>{item.title}</strong><small>{item.schedule} · 下次：{formatTime(item.next_run_at)}</small></div><span className={`task-status ${tone(item.status)}`}>{item.enabled ? item.status : '已暂停'}</span><button className="task-toggle" onClick={() => void toggleTask(item)}>{item.enabled ? '暂停' : '启用'}</button><button className="task-run" onClick={() => void runTask(item.id)} disabled={item.status === '执行中'}>▶ 执行</button><button className="task-edit" onClick={() => openEditTask(item)}>编辑</button><button className="task-delete" onClick={() => void deleteTask(item)}>×</button></div>)}</div>{!tasks.length && <div className="task-list-empty">当前项目还没有任务</div>}</div>
        <div className="project-linked panel"><div className="section-title"><div><h2>关联作品</h2><p>从“我的作品”加入当前项目的内容</p></div><span className="run-count">{linkedWorks.length} 件作品</span></div><div className="project-linked-grid">{linkedWorks.slice(0, 6).map((work) => <article key={work.key}>{work.type === 'image' && work.data_url ? <img src={work.data_url} alt={work.title} /> : <span>{work.type === 'text' ? 'TEXT' : '图片丢失'}</span>}<div><strong>{work.title}</strong><small>{work.provider || '本地'}{work.model ? ` · ${work.model}` : ''}</small></div></article>)}</div>{!linkedWorks.length && <div className="task-list-empty">还没有关联作品，可从“我的作品”中加入</div>}</div>
        <div className="project-history panel"><div className="section-title"><div><h2>最近执行</h2><p>查看项目任务的执行结果</p></div><span className="run-count">{runs.length} 条记录</span></div>{runs.slice(0, 5).map((run) => <div className="history-row" key={run.id}><span className={`history-icon ${run.status === '失败' ? 'failed' : ''}`}>{run.status === '失败' ? '!' : run.status === '执行中' ? '●' : '✓'}</span><div><strong>{run.task_title}</strong><small>{formatTime(run.started_at)}{run.error ? ` · ${run.error}` : ''}</small></div><b className={run.status === '失败' ? 'failed-text' : ''}>{run.status}</b></div>)}{!runs.length && <div className="task-list-empty">暂无执行记录</div>}</div>
      </section>
    </div>}

    {showProjectModal && <div className="project-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProjectModal(false) }}><section className="project-modal panel" role="dialog" aria-modal="true"><div className="project-modal-title"><div><p className="home-kicker">{editingProject ? 'EDIT PROJECT' : 'NEW PROJECT'}</p><h2>{editingProject ? '编辑项目' : '新建项目'}</h2><span>{editingProject ? '更新项目名称和说明' : '创建一个新的内容项目空间'}</span></div><button onClick={() => setShowProjectModal(false)}>×</button></div><label><span>项目名称</span><input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void saveProject()} placeholder="例如：小红书秋季运营" /></label><label><span>项目说明</span><textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="简单描述项目目标（可选）" /></label><div className="project-modal-actions"><button className="outline-button" onClick={() => setShowProjectModal(false)}>取消</button><button className="gradient-button" disabled={!projectName.trim()} onClick={() => void saveProject()}>{editingProject ? '保存修改' : '创建项目'}</button></div></section></div>}

    {showTaskModal && <div className="project-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTaskModal(false) }}><section className="project-modal task-modal panel" role="dialog" aria-modal="true"><div className="project-modal-title"><div><p className="home-kicker">{editingTask ? 'EDIT TASK' : 'NEW TASK'}</p><h2>{editingTask ? '编辑任务' : '添加任务'}</h2><span>设置任务内容、执行方式和状态</span></div><button onClick={() => setShowTaskModal(false)}>×</button></div><label><span>任务名称</span><input autoFocus value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如：生成本周选题" /></label><label><span>执行方式</span><select value={taskSchedule} onChange={(event) => setTaskSchedule(event.target.value)}><option>手动执行</option><option>每天 09:00</option><option>每天 18:00</option><option>每周一 09:00</option><option>每周五 18:00</option><option>上一步完成后</option></select></label>{editingTask && <label><span>任务状态</span><select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)}><option>待执行</option><option>执行中</option><option>已完成</option><option>失败</option></select></label>}<label className="task-enabled-row"><input type="checkbox" checked={taskEnabled} onChange={(event) => setTaskEnabled(event.target.checked)} /><span>启用自动执行</span></label><div className="project-modal-actions"><button className="outline-button" onClick={() => setShowTaskModal(false)}>取消</button><button className="gradient-button" disabled={!taskTitle.trim()} onClick={() => void saveTask()}>{editingTask ? '保存修改' : '添加任务'}</button></div></section></div>}
    <AppDialog controller={appDialog} />
  </main>
}
