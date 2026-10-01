import type { AgentStep, VideoTask } from '../types'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export async function runTool(task: VideoTask, step: AgentStep, update: (task: VideoTask) => void) {
  step.status = 'running'; step.progress = 10; update(task)
  await pause(250); step.progress = 60; update(task)
  await pause(250); step.status = 'completed'; step.progress = 100; step.result = `${step.label}完成`; update(task)
}
