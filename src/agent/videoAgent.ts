import { runTool } from './tools'
import type { AgentStep, VideoTask } from './types'

const steps = (): AgentStep[] => [
  { id: 'script', label: '提取并改写文案', status: 'pending', progress: 0 },
  { id: 'tts', label: '生成配音', status: 'pending', progress: 0 },
  { id: 'subtitle', label: '生成字幕', status: 'pending', progress: 0 },
  { id: 'compose', label: '合成最终视频', status: 'pending', progress: 0 }
]

export async function runVideoAgent(prompt: string, onUpdate: (task: VideoTask) => void) {
  const task: VideoTask = { id: `task-${Date.now()}`, prompt, status: 'running', steps: steps(), outputs: [] }
  onUpdate(structuredClone(task))
  for (const step of task.steps) await runTool(task, step, () => onUpdate(structuredClone(task)))
  task.status = 'completed'
  task.outputs = ['D:/成片/案例视频_改写版.mp4', 'D:/成片/案例视频_改写版.srt']
  onUpdate(structuredClone(task))
  return task
}
