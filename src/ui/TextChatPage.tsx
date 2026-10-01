import { useEffect, useMemo, useRef, useState } from 'react'
import { AppDialog, useAppDialog } from './AppDialog'

const templates = [
  { name: '小红书文案', prompt: '请写一篇小红书文案。主题是：\n目标人群：\n核心卖点：\n语气：自然、有画面感，结尾加入互动问题。' },
  { name: '短视频脚本', prompt: '请创作一个 60 秒短视频脚本。主题是：\n请按“开场钩子—核心内容—行动引导”组织，并给出画面和口播。' },
  { name: '标题灵感', prompt: '围绕以下主题生成 10 个有吸引力但不过度夸张的标题，并标注每个标题适合的平台：\n' },
  { name: '内容改写', prompt: '请在保留事实和核心观点的前提下，改写以下内容，让表达更简洁、更自然：\n' }
]

export function TextChatPage({ recreate }: { recreate?: RecreatePayload }) {
  const appDialog = useAppDialog()
  const [conversations, setConversations] = useState<RainbowConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<RainbowMessage[]>([])
  const [providers, setProviders] = useState<TextProviderConfig[]>([])
  const [provider, setProvider] = useState('OpenAI')
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Array<{ name: string; content: string }>>([])
  const [panel, setPanel] = useState<'none' | 'templates' | 'settings'>('none')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [mode, setMode] = useState<'chat' | 'agent'>('chat')
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(() => {
    const saved = localStorage.getItem('rainbow-agent-permission')
    return saved === 'ask' || saved === 'full' ? saved : 'smart'
  })
  const [approval, setApproval] = useState<AgentApprovalPrompt | null>(null)
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const messageEnd = useRef<HTMLDivElement>(null)

  const selectedProvider = providers.find((item) => item.provider === provider)
  const configuredProviders = providers.filter((item) => item.configured && item.model)
  const generating = Boolean(requestId)

  useEffect(() => {
    Promise.all([window.electronAPI.chat.providers(), window.electronAPI.conversations.list()]).then(([providerRows, conversationRows]) => {
      setProviders(providerRows); setConversations(conversationRows)
      const firstProvider = providerRows.find((item) => item.configured && item.model) ?? providerRows[0]
      if (firstProvider) setProvider(firstProvider.provider)
      const restored = recreate?.conversationId ? conversationRows.find((item) => item.id === recreate.conversationId) : undefined
      if (restored) { setActiveId(restored.id); setProvider(restored.provider) }
      else if (conversationRows[0] && !recreate) { setActiveId(conversationRows[0].id); setProvider(conversationRows[0].provider) }
      if (recreate?.prompt) setPrompt(recreate.prompt)
      if (recreate?.provider && providerRows.some((item) => item.provider === recreate.provider)) setProvider(recreate.provider)
    }).catch((error) => setNotice(error instanceof Error ? error.message : '对话数据加载失败')).finally(() => setLoading(false))
  }, [recreate])

  useEffect(() => {
    if (!activeId) { setMessages([]); setAgentRuns([]); return }
    Promise.all([window.electronAPI.conversations.messages(activeId), window.electronAPI.agent.runs(activeId)]).then(([messageRows, runRows]) => { setMessages(messageRows); setAgentRuns(runRows) }).catch((error) => setNotice(error instanceof Error ? error.message : '消息加载失败'))
  }, [activeId])

  useEffect(() => {
    const offDelta = window.electronAPI.chat.onDelta((event) => {
      setMessages((current) => current.map((message) => message.id === event.messageId ? { ...message, content: message.content + (event.delta ?? '') } : message))
    })
    const finish = (event: ChatEvent) => {
      setMessages((current) => current.map((message) => message.id === event.messageId ? { ...message, content: event.content ?? message.content, status: event.status ?? 'completed', error: event.error ?? null } : message))
      setRequestId((current) => current === event.requestId ? null : current)
      void refreshConversations()
    }
    const offDone = window.electronAPI.chat.onDone(finish)
    const offError = window.electronAPI.chat.onError((event) => { finish(event); setNotice(event.error || '生成失败') })
    const offAgentDelta = window.electronAPI.agent.onDelta((event) => {
      setMessages((current) => current.map((message) => message.id === event.messageId ? { ...message, content: message.content + (event.delta ?? '') } : message))
    })
    const finishAgent = (event: ChatEvent) => {
      finish(event)
      setAgentRuns((current) => current.map((run) => run.request_id === event.requestId ? { ...run, status: event.status === 'cancelled' ? 'cancelled' : event.status === 'failed' ? 'failed' : 'completed', summary: event.content ?? run.summary, error: event.error ?? null, finished_at: new Date().toISOString() } : run))
    }
    const offAgentDone = window.electronAPI.agent.onDone(finishAgent)
    const offAgentError = window.electronAPI.agent.onError((event) => { finishAgent(event); setNotice(event.error || 'Agent 执行失败') })
    const offAgentTool = window.electronAPI.agent.onTool((event) => {
      setAgentRuns((current) => current.map((run) => run.id === event.runId ? { ...run, steps: [...run.steps.filter((step) => step.id !== event.step.id), event.step].sort((a, b) => a.id - b.id) } : run))
    })
    const offApproval = window.electronAPI.agent.onApproval(setApproval)
    return () => { offDelta(); offDone(); offError(); offAgentDelta(); offAgentDone(); offAgentError(); offAgentTool(); offApproval() }
  }, [])

  useEffect(() => { messageEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function refreshConversations() { setConversations(await window.electronAPI.conversations.list()) }
  async function refreshAgentRuns(conversationId: number) { setAgentRuns(await window.electronAPI.agent.runs(conversationId)) }
  function newConversation() { if (generating) return; setActiveId(null); setMessages([]); setPrompt(''); setAttachments([]); setNotice('') }
  async function openConversation(id: number) { if (generating) return; const item = conversations.find((conversation) => conversation.id === id); if (item) setProvider(item.provider); setActiveId(id); setNotice('') }
  async function renameConversation(item: RainbowConversation) { const title = await appDialog.prompt({ title: '修改对话名称', value: item.title, confirmLabel: '保存名称' }); if (!title) return; await window.electronAPI.conversations.update(item.id, title); await refreshConversations() }
  async function removeConversation(item: RainbowConversation) { const confirmed = await appDialog.confirm({ title: '删除对话', message: `确定删除“${item.title}”及其全部消息吗？删除后无法恢复。`, confirmLabel: '删除对话', tone: 'danger' }); if (!confirmed) return; await window.electronAPI.conversations.delete(item.id); const rows = await window.electronAPI.conversations.list(); setConversations(rows); if (activeId === item.id) { setActiveId(rows[0]?.id ?? null); setMessages([]) } }

  async function sendPrompt(override?: string) {
    const raw = (override ?? prompt).trim()
    if (!raw || generating) return
    if (!selectedProvider?.configured) { setNotice(`请先在“API 与模型”中配置 ${provider} API Key`); return }
    let fullPrompt = raw
    if (attachments.length) fullPrompt += `\n\n以下是参考素材：\n${attachments.map((file) => `--- ${file.name} ---\n${file.content}`).join('\n\n')}`
    setNotice('')
    let conversationId = activeId
    if (!conversationId) {
      const conversation = await window.electronAPI.conversations.create(raw.slice(0, 28), provider, selectedProvider.model)
      conversationId = conversation.id; setActiveId(conversation.id); setConversations((current) => [conversation, ...current])
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setRequestId(id); setPrompt(''); setAttachments([])
    try {
      if (mode === 'agent') {
        const result = await window.electronAPI.agent.start(id, conversationId, fullPrompt, provider, permissionMode)
        setMessages((current) => [...current, result.userMessage, result.assistantMessage]); setAgentRuns((current) => [result.run, ...current])
      } else {
        const result = await window.electronAPI.chat.start(id, conversationId, fullPrompt, provider)
        setMessages((current) => [...current, result.userMessage, result.assistantMessage])
      }
    } catch (error) { setRequestId(null); setPrompt(raw); setNotice(error instanceof Error ? error.message : '无法开始对话') }
  }

  async function stop() { if (requestId) await (mode === 'agent' ? window.electronAPI.agent.stop(requestId) : window.electronAPI.chat.stop(requestId)) }
  async function changeMode(nextMode: 'chat' | 'agent') {
    if (generating || nextMode === mode) return
    if (nextMode === 'agent') {
      const approved = await appDialog.confirm({ title: '启用 PI Agent 操作模式', message: `当前权限为“${permissionMode === 'ask' ? '每次询问' : permissionMode === 'smart' ? '智能批准' : '完全访问'}”。Agent 可使用文件和终端工具，实际执行将严格遵守该权限等级。`, confirmLabel: '启用 Agent' })
      if (!approved) return
    }
    setMode(nextMode); setNotice(nextMode === 'agent' ? '已启用 PI Agent 操作模式' : '')
  }
  async function changePermission(next: AgentPermissionMode) {
    if (generating || next === permissionMode) return
    if (next === 'full') {
      const confirmed = await appDialog.confirm({ title: '启用完全访问', message: 'Pi Agent 将可以在当前 Windows 账户权限范围内读取和修改任意文件、执行 Bash/PowerShell 命令并访问网络，工具调用不再逐项确认。是否继续？', confirmLabel: '确认完全访问', tone: 'danger' })
      if (!confirmed) return
    }
    localStorage.setItem('rainbow-agent-permission', next); setPermissionMode(next)
  }
  async function respondApproval(decision: AgentApprovalDecision) {
    if (!approval) return
    const current = approval; setApproval(null)
    const accepted = await window.electronAPI.agent.respondApproval(current.approvalId, decision)
    if (!accepted) setNotice('该审批已过期或任务已经停止')
  }
  async function addAttachments() { try { const files = await window.electronAPI.chat.selectAttachments(); setAttachments((current) => [...current, ...files]) } catch (error) { setNotice(error instanceof Error ? error.message : '素材读取失败') } }
  async function saveWork(message: RainbowMessage) { const title = conversations.find((item) => item.id === activeId)?.title || '文本作品'; await window.electronAPI.works.saveText(title, message.content, activeId ?? undefined); setNotice('已保存到“我的作品”') }
  const lastUserText = useMemo(() => [...messages].reverse().find((message) => message.role === 'user')?.content ?? '', [messages])

  return <main className="text-chat-page">
    <header className="text-chat-heading"><div><p className="home-kicker">RAINBOW AI · PI AGENT</p><h1>对话与操作</h1><p>{mode === 'agent' ? '理解任务、操作工作区并展示每一步执行。' : '真实模型驱动的内容创作空间。'}</p><div className="chat-page-mode"><button className={mode === 'chat' ? 'selected' : ''} onClick={() => void changeMode('chat')}>✦ 对话模式</button><button className={mode === 'agent' ? 'selected agent-selected' : ''} onClick={() => void changeMode('agent')}>⌘ Agent 操作</button>{mode === 'agent' ? <select value={permissionMode} disabled={generating} onChange={(event) => void changePermission(event.target.value as AgentPermissionMode)}><option value="ask">每次询问</option><option value="smart">智能批准</option><option value="full">完全访问</option></select> : <small>不调用工具</small>}</div></div><button className="gradient-button" onClick={newConversation} disabled={generating}>＋ 新对话</button></header>
    {notice && <div className="chat-notice"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
    <section className="chat-layout">
      <aside className="chat-history panel"><div className="chat-history-title"><strong>最近对话</strong><span>{conversations.length}</span></div><button className="chat-new-small" onClick={newConversation}>＋ 开始新对话</button><div className="chat-history-list">{conversations.map((item) => <button key={item.id} className={activeId === item.id ? 'selected' : ''} onClick={() => void openConversation(item.id)}><span>{item.title}</span><small>{item.provider} · {item.model}</small>{activeId === item.id && <i><b onClick={(event) => { event.stopPropagation(); void renameConversation(item) }}>改名</b><b onClick={(event) => { event.stopPropagation(); void removeConversation(item) }}>删除</b></i>}</button>)}</div>{!conversations.length && <p className="chat-history-empty">还没有历史对话</p>}</aside>
      <div className="chat-main panel">
        <div className="chat-toolbar"><button className={panel === 'templates' ? 'selected' : ''} onClick={() => setPanel(panel === 'templates' ? 'none' : 'templates')}>▤ 写作模板</button><button className={panel === 'settings' ? 'selected' : ''} onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>⚙ 设置</button><span className={selectedProvider?.configured ? 'ready' : 'missing'}>{selectedProvider?.configured ? `● ${provider} · ${selectedProvider.model}` : `○ ${provider} 未配置`}</span></div>
        <div className={`chat-context-panel ${panel}`}>{panel === 'templates' && <div className="chat-templates">{templates.map((item) => <button key={item.name} onClick={() => { setPrompt(item.prompt); setPanel('none') }}><strong>{item.name}</strong><small>{item.prompt.split('\n')[0]}</small></button>)}</div>}{panel === 'settings' && <div className="chat-settings"><label><span>本次对话使用的模型服务</span><select value={provider} disabled={generating} onChange={(event) => setProvider(event.target.value)}>{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider} · {item.model || '未设置模型'}{item.configured ? '' : '（未配置）'}</option>)}</select></label><p>已配置 {configuredProviders.length} 个可用文本服务。模型参数由“API 与模型”页面统一管理。</p></div>}</div>
        <div className="chat-messages">{loading ? <div className="chat-empty">正在加载本地对话…</div> : messages.length ? messages.map((message) => <article key={message.id} className={`chat-message ${message.role} ${message.status}`}><div className="chat-avatar">{message.role === 'user' ? '你' : mode === 'agent' ? '⌘' : '✦'}</div><div className="chat-bubble"><header><strong>{message.role === 'user' ? '你' : 'Rainbow AI'}</strong><small>{new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></header><div className="chat-content">{message.content || (message.status === 'streaming' ? <span className="typing">{mode === 'agent' ? '正在规划并检查可用工具' : '正在思考'}<i /><i /><i /></span> : '')}</div>{message.error && <p className="chat-error">{message.error}</p>}{message.role === 'assistant' && message.content && message.status !== 'streaming' && <footer><button onClick={() => navigator.clipboard.writeText(message.content)}>复制</button><button onClick={() => void saveWork(message)}>保存作品</button>{message.status === 'failed' && lastUserText && <button onClick={() => void sendPrompt(lastUserText)}>重新生成</button>}</footer>}</div></article>) : <div className="chat-empty"><div className="studio-symbol">✦</div><h2>{mode === 'agent' ? '告诉 Agent 要执行什么' : '告诉我你想写什么'}</h2><p>{mode === 'agent' ? '可以查询软件数据、读取和修改文件，或执行终端任务。' : '可以写标题、短视频脚本、广告文案，或整理一段复杂思路。'}</p></div>}{mode === 'agent' && agentRuns.length > 0 && <div className="agent-run-list">{agentRuns.slice(0, 5).map((run) => <section className={`agent-run-card ${run.status}`} key={run.id}><header><div><strong>PI Agent 执行 #{run.id}</strong><small>{run.provider} · {run.model}</small></div><span>{run.status === 'running' ? '执行中' : run.status === 'completed' ? '已完成' : run.status === 'cancelled' ? '已停止' : '失败'}</span></header>{run.steps.length ? <div className="agent-step-list">{run.steps.map((step) => <div className={`agent-step ${step.status} ${step.risk}`} key={step.id}><i>{step.status === 'running' ? '···' : step.status === 'completed' ? '✓' : '!'}</i><div><strong>{step.label}</strong><small>{step.risk === 'read' ? '读取工具' : step.risk === 'write' ? '文件修改' : '终端操作'} · {step.status === 'running' ? '执行中' : step.status === 'completed' ? '已完成' : step.error || '执行失败'}</small></div></div>)}</div> : <p>正在分析任务，尚未调用工具。</p>}</section>)}</div>}<div ref={messageEnd} /></div>
        <div className={`chat-composer ${mode === 'agent' ? 'agent-composer' : ''}`}>{mode === 'agent' && <div className={`agent-permission-bar ${permissionMode}`}><span>{permissionMode === 'ask' ? '每次询问' : permissionMode === 'smart' ? '智能批准' : '完全访问'}</span>{permissionMode === 'ask' ? '修改文件和终端命令执行前确认。' : permissionMode === 'smart' ? '项目内修改自动执行，终端和项目外操作需要确认。' : '所有原生工具直接执行，请谨慎使用。'}</div>}{attachments.length > 0 && <div className="chat-attachments">{attachments.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}<textarea value={prompt} disabled={generating} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void sendPrompt() }} placeholder={mode === 'agent' ? '输入要查询或执行的任务…（Ctrl + Enter 执行）' : '输入你的问题或创作需求…（Ctrl + Enter 发送）'} /><div><button className="chat-attach" disabled={generating} onClick={() => void addAttachments()}>＋ 添加文本素材</button><span>{prompt.length} 字</span>{generating ? <button className="chat-stop" onClick={() => void stop()}>■ {mode === 'agent' ? '停止执行' : '停止生成'}</button> : <button className="chat-send" disabled={!prompt.trim()} onClick={() => void sendPrompt()}>{mode === 'agent' ? '交给 Agent' : '发送'}　↑</button>}</div></div>
      </div>
    </section>
    {approval && <div className="agent-approval-backdrop"><section className="agent-approval-dialog panel" role="dialog" aria-modal="true"><header><div><span>PI AGENT APPROVAL</span><h2>{approval.label}</h2></div><b className={approval.risk}>{approval.risk === 'system' ? '终端操作' : '文件修改'}</b></header><p>{approval.reason}</p><div className="agent-approval-meta"><span>工作目录</span><code>{approval.cwd}</code><span>调用参数</span><pre>{JSON.stringify(approval.input, null, 2).slice(0, 12000)}</pre></div><footer><button onClick={() => void respondApproval('deny')}>拒绝</button><button onClick={() => void respondApproval('allow_session')}>本次会话允许</button><button className="gradient-button" onClick={() => void respondApproval('allow_once')}>允许一次</button></footer></section></div>}
    <AppDialog controller={appDialog} />
  </main>
}
