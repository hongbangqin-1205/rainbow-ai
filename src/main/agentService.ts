import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { app } from 'electron'
import { Type, type TSchema } from 'typebox'
import { createAgentSession, createBashToolDefinition, createEditToolDefinition, createExtensionRuntime, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createPowerShellToolDefinition, createReadToolDefinition, createWriteToolDefinition, defineTool, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ResourceLoader, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { listProjects, listTasks, listUnifiedWorksPage, type ModelConfigRow, type WorkType } from './database'
import { loadApiKey } from './modelConfig'

export type AgentEvent =
  | { type: 'delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; label: string; risk: AgentToolRisk; input: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; output: unknown; isError: boolean }

export type AgentPermissionMode = 'ask' | 'smart' | 'full'
export type AgentToolRisk = 'read' | 'write' | 'system'
export type AgentApprovalDecision = 'allow_once' | 'allow_session' | 'deny'
export type AgentApprovalRequest = { requestId: string; toolCallId: string; toolName: string; label: string; risk: AgentToolRisk; reason: string; input: unknown; cwd: string }

const labels: Record<string, string> = {
  app_overview: '读取工作台概览',
  list_projects: '读取项目列表',
  list_project_tasks: '读取项目任务',
  search_works: '检索我的作品', read: '读取文件', grep: '搜索文件内容', find: '查找文件', ls: '列出目录', write: '写入文件', edit: '编辑文件', bash: '执行 Bash 命令', powershell: '执行 PowerShell 命令'
}

const jsonResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], details: value })

const appTools = [
  defineTool({
    name: 'app_overview', label: labels.app_overview, description: '读取 Rainbow AI 中项目、任务和各类型作品的数量概览。只读。', parameters: Type.Object({}),
    execute: async () => {
      const projects = listProjects()
      const tasks = projects.flatMap((project) => listTasks(project.id))
      const works = listUnifiedWorksPage({ page: 1, pageSize: 12 })
      return jsonResult({ projects: projects.length, tasks: tasks.length, taskStatus: tasks.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {}), works: works.counts, latestWorkAt: works.latest })
    }
  }),
  defineTool({
    name: 'list_projects', label: labels.list_projects, description: '列出 Rainbow AI 的项目空间及每个项目的任务数量。只读。', parameters: Type.Object({}),
    execute: async () => jsonResult(listProjects().map((project) => ({ ...project, taskCount: listTasks(project.id).length })))
  }),
  defineTool({
    name: 'list_project_tasks', label: labels.list_project_tasks, description: '按项目 ID 读取任务清单和状态。只读。', parameters: Type.Object({ projectId: Type.Number({ minimum: 1 }) }),
    execute: async (_id, input) => jsonResult(listTasks(input.projectId))
  }),
  defineTool({
    name: 'search_works', label: labels.search_works, description: '按关键词及类型检索“我的作品”。返回标题、模型、时间和作品编号，不读取媒体文件。只读。',
    parameters: Type.Object({ query: Type.Optional(Type.String({ maxLength: 100 })), kind: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('text'), Type.Literal('image'), Type.Literal('video'), Type.Literal('audio')])) }),
    execute: async (_id, input) => {
      const result = listUnifiedWorksPage({ page: 1, pageSize: 20, query: input.query, kind: (input.kind ?? 'all') as 'all' | WorkType })
      return jsonResult({ total: result.total, items: result.items.map(({ key, type, title, provider, model, created_at, favorite, tags }) => ({ key, type, title, provider, model, createdAt: created_at, favorite: Boolean(favorite), tags })) })
    }
  })
]

const readTools = new Set(['read', 'grep', 'find', 'ls', 'app_overview', 'list_projects', 'list_project_tasks', 'search_works'])
const writeTools = new Set(['write', 'edit'])

function toolRisk(toolName: string): AgentToolRisk { return readTools.has(toolName) ? 'read' : writeTools.has(toolName) ? 'write' : 'system' }
function inputPath(input: unknown) {
  if (!input || typeof input !== 'object') return ''
  const value = (input as Record<string, unknown>).path
  return typeof value === 'string' ? value : ''
}
function staysInside(cwd: string, path: string) {
  if (!path) return false
  const target = resolve(cwd, isAbsolute(path) ? path : join(cwd, path))
  const child = relative(resolve(cwd), target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}
function approvalReason(mode: AgentPermissionMode, toolName: string, input: unknown, cwd: string) {
  if (mode === 'full' || readTools.has(toolName)) return ''
  if (mode === 'smart' && writeTools.has(toolName) && staysInside(cwd, inputPath(input))) return ''
  if (writeTools.has(toolName)) return mode === 'smart' ? '目标位于当前项目目录之外，需要确认。' : '该操作会修改文件，需要确认。'
  return '终端命令能够访问文件、网络或启动其他程序，需要确认。'
}

function withApproval<TParams extends TSchema, TDetails, TState>(definition: ToolDefinition<TParams, TDetails, TState>, permissionMode: AgentPermissionMode, requestId: string, cwd: string, allowedForSession: Set<string>, approve: (request: AgentApprovalRequest) => Promise<AgentApprovalDecision>) {
  return defineTool({
    ...definition,
    execute: async (toolCallId, input, signal, onUpdate, context) => {
      const reason = approvalReason(permissionMode, definition.name, input, cwd)
      if (reason && !allowedForSession.has(definition.name)) {
        const decision = await approve({ requestId, toolCallId, toolName: definition.name, label: labels[definition.name] ?? definition.label, risk: toolRisk(definition.name), reason, input, cwd })
        if (decision === 'deny') throw new Error(`用户拒绝执行：${labels[definition.name] ?? definition.name}`)
        if (decision === 'allow_session') allowedForSession.add(definition.name)
      }
      return definition.execute(toolCallId, input, signal, onUpdate, context)
    }
  })
}

function nativeTools(cwd: string, permissionMode: AgentPermissionMode, requestId: string, approve: (request: AgentApprovalRequest) => Promise<AgentApprovalDecision>) {
  const allowedForSession = new Set<string>()
  return [
    withApproval(createReadToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createGrepToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createFindToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createLsToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createWriteToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createEditToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createBashToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve),
    withApproval(createPowerShellToolDefinition(cwd), permissionMode, requestId, cwd, allowedForSession, approve)
  ]
}

function providerId(provider: string) { return `rainbow-${createHash('sha256').update(provider).digest('hex').slice(0, 12)}` }
function apiType(protocol: ModelConfigRow['api_protocol']) {
  if (protocol === 'responses') return 'openai-responses'
  if (protocol === 'claude_messages') return 'anthropic-messages'
  return 'openai-completions'
}

function resourceLoader(permissionMode: AgentPermissionMode, cwd: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => `你是 Rainbow AI 的 PI Agent，当前工作目录是 ${cwd}，权限等级是 ${permissionMode}。你既可以正常对话，也可以调用当前提供的工具完成用户任务。工具是否需要确认由宿主软件强制控制；被拒绝时停止该操作并说明。不要绕过审批，不要声称执行了未实际完成的操作。回答使用中文，先给结果，再简要说明依据。`,
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {}
  }
}

export async function createRainbowAgent(config: Omit<ModelConfigRow, 'updated_at'>, options: { requestId: string; permissionMode: AgentPermissionMode; cwd: string; approve: (request: AgentApprovalRequest) => Promise<AgentApprovalDecision> }, onEvent: (event: AgentEvent) => void): Promise<AgentSession> {
  const key = loadApiKey(config.provider)
  if (!key) throw new Error(`请先配置 ${config.provider} API Key`)
  const modelId = config.text_model || config.default_model
  if (!modelId) throw new Error(`请先配置 ${config.provider} 文本模型`)
  const id = providerId(config.provider)
  const agentDir = join(app.getPath('userData'), 'pi-agent')
  mkdirSync(agentDir, { recursive: true })
  const modelsPath = join(agentDir, 'models.json')
  writeFileSync(modelsPath, JSON.stringify({ providers: { [id]: { baseUrl: config.base_url, api: apiType(config.api_protocol), models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: Math.max(32768, config.max_tokens * 8), maxTokens: config.max_tokens }] } } }, null, 2), { encoding: 'utf8', mode: 0o600 })
  const modelRuntime = await ModelRuntime.create({ modelsPath, authPath: join(agentDir, 'auth.json'), refreshOnCreate: false })
  await modelRuntime.setRuntimeApiKey(id, key)
  const model = modelRuntime.getModel(id, modelId)
  if (!model) throw new Error(`PI Agent 无法加载模型 ${modelId}`)
  const enabledTools = [...appTools, ...nativeTools(options.cwd, options.permissionMode, options.requestId, options.approve)]
  const toolNames = enabledTools.map((tool) => tool.name)
  const { session } = await createAgentSession({ cwd: options.cwd, agentDir, modelRuntime, model, thinkingLevel: 'off', tools: toolNames, customTools: enabledTools, resourceLoader: resourceLoader(options.permissionMode, options.cwd), sessionManager: SessionManager.inMemory(options.cwd), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: Math.min(1, config.retry_count) } }) })
  session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') onEvent({ type: 'delta', delta: event.assistantMessageEvent.delta })
    if (event.type === 'tool_execution_start') onEvent({ type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, label: labels[event.toolName] ?? event.toolName, risk: toolRisk(event.toolName), input: event.args })
    if (event.type === 'tool_execution_end') onEvent({ type: 'tool_end', toolCallId: event.toolCallId, toolName: event.toolName, output: event.result, isError: event.isError })
  })
  return session
}
