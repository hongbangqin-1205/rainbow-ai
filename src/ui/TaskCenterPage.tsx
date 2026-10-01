import { useState } from 'react'
import { runVideoAgent } from '../agent/videoAgent'
import type { VideoTask } from '../agent/types'

type Tab = 'tasks' | 'api' | 'data'

export function TaskCenterPage() {
  const [tab, setTab] = useState<Tab>('tasks')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState<VideoTask>()
  const [apiKey, setApiKey] = useState('')
  async function submit() { if (running || !prompt.trim()) return; setRunning(true); try { await runVideoAgent(prompt, setTask) } finally { setRunning(false) } }
  return <main className="task-center-page">
    <header className="task-center-heading"><div><p className="home-kicker">RAINBOW AI · CONTROL CENTER</p><h1>任务中心</h1><p>管理任务、配置模型，查看你的创作数据。</p></div><span className="task-ready"><i />系统就绪</span></header>
    <nav className="task-tabs"><button className={tab === 'tasks' ? 'selected' : ''} onClick={() => setTab('tasks')}>任务记录</button><button className={tab === 'api' ? 'selected' : ''} onClick={() => setTab('api')}>API 配置</button><button className={tab === 'data' ? 'selected' : ''} onClick={() => setTab('data')}>数据管理</button></nav>
    {tab === 'tasks' && <section className="task-layout"><div className="task-create panel"><div className="task-panel-title"><div><h2>新建任务</h2><p>把想做的事情告诉 Rainbow AI</p></div><span>Agent</span></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把这段视频改成小红书风格..." /><div className="task-create-footer"><span>⌕ 添加文件</span><button onClick={submit} disabled={running || !prompt.trim()}>{running ? '执行中…' : '开始执行　↑'}</button></div></div><div className="task-records panel"><div className="task-panel-title"><div><h2>最近任务</h2><p>查看任务状态和执行结果</p></div><button className="text-button">查看全部</button></div>{task ? <div className="task-record active-record"><b>{task.status === 'completed' ? '✓' : '●'}</b><div><strong>{prompt || '新建创作任务'}</strong><small>{task.status === 'completed' ? '已完成' : '正在执行'}</small></div><span>{task.status === 'completed' ? '完成' : `${task.steps.find((step) => step.status === 'running')?.progress ?? 0}%`}</span></div> : <div className="task-empty"><span>◌</span><p>还没有任务记录</p><small>提交第一个任务后，会显示在这里</small></div>}</div></section>}
    {tab === 'api' && <section className="simple-settings panel"><div className="task-panel-title"><div><h2>API 与模型配置</h2><p>连接模型服务后，即可使用 AI 创作能力。</p></div><span className="setting-dot">安全存储</span></div><label><span>服务商</span><select><option>OpenAI 兼容接口</option><option>DeepSeek</option><option>通义千问</option></select></label><label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入 API Key" /></label><label><span>默认模型</span><select><option>gpt-4o-mini</option><option>deepseek-chat</option><option>qwen-plus</option></select></label><div className="settings-actions"><button className="outline-button">测试连接</button><button className="gradient-button">保存配置</button></div></section>}
    {tab === 'data' && <section className="data-panel-grid"><div className="data-card panel"><span>▣</span><div><strong>我的素材</strong><small>图片、视频、音频和文件</small></div><b>0</b></div><div className="data-card panel"><span>✦</span><div><strong>生成记录</strong><small>所有 AI 生成内容</small></div><b>0</b></div><div className="data-card panel"><span>⌫</span><div><strong>本地数据</strong><small>清理缓存和临时文件</small></div><button className="outline-button">管理</button></div></section>}
  </main>
}
