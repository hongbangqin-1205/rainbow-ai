export type StepStatus = 'pending' | 'running' | 'completed' | 'failed'
export interface AgentStep { id: string; label: string; status: StepStatus; progress: number; result?: string }
export interface VideoTask { id: string; prompt: string; status: 'running' | 'completed' | 'failed'; steps: AgentStep[]; outputs: string[] }
