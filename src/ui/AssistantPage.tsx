import { useState } from 'react'
import { runVideoAgent } from '../agent/videoAgent'
import type { VideoTask } from '../agent/types'

export function AssistantPage() {
  const [prompt, setPrompt] = useState('把这个视频改成小红书风格，控制在45秒，使用女声，添加黄色字幕，不要背景音乐。')
  const [task, setTask] = useState<VideoTask>()
  const [running, setRunning] = useState(false)
  async function submit() { if (running || !prompt.trim()) return; setRunning(true); try { await runVideoAgent(prompt, setTask) } finally { setRunning(false) } }
  return <main className="assistant-page"><section className="panel"><h1>厉影智能助手</h1><p className="bubble">告诉我你想制作什么视频，我会自动规划和执行。</p><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button onClick={submit} disabled={running}>{running ? '执行中…' : '开始执行'}</button></section><section className="panel"><h2>任务执行</h2>{!task && <p className="muted">提交任务后显示 Agent 计划。</p>}{task?.steps.map((step) => <div className="step" key={step.id}><b>{step.status === 'completed' ? '✓' : step.status === 'running' ? '●' : '○'}</b><span>{step.label}<small>{step.status === 'running' ? `${step.progress}%` : step.status}</small></span></div>)}{task?.status === 'completed' && <p className="success">输出：{task.outputs.join('、')}</p>}</section></main>
}
