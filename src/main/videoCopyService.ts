import { resolveTextConfig } from './modelConfig'
import { streamModelReply } from './chatService'

export type VideoCopyInput = { action: 'generate' | 'legal'; mode: 'breakdown' | 'inspiration' | 'original'; source: string; targetLength: number; language: string; subject?: string; product?: string; audience?: string; platform?: string; style?: string; rewriteStrength?: number; provider?: string }

export async function createVideoCopy(input: VideoCopyInput, controller: AbortController) {
  const config = resolveTextConfig(input.provider)
  const prompt = buildPrompt(input)
  let content = ''; let serviceError = ''
  const timer = setTimeout(() => controller.abort(), config.timeout_seconds * 1000)
  try {
    await streamModelReply(config, [{ id: 0, conversation_id: 0, role: 'user', content: prompt, status: 'completed', error: null, created_at: new Date().toISOString() }], controller, { onDelta: (delta) => { content += delta }, onDone: () => {}, onError: (message) => { serviceError = message } })
    if (serviceError) throw new Error(serviceError)
    if (!content.trim()) throw new Error('模型未返回文案内容')
    return { content: content.trim(), provider: config.provider, model: config.text_model || config.default_model }
  } finally { clearTimeout(timer) }
}

function buildPrompt(input: VideoCopyInput) {
  const language = input.language === 'en' ? '英文' : '中文'
  if (input.action === 'legal') return `你是中国新媒体广告合规审校助手。检查以下文案中的敏感词、绝对化用语、无法证实的功效承诺、侵权风险和平台违规风险。请输出：\n1. 风险等级\n2. 风险原句与原因\n3. 建议改法\n4. 一份合规修改稿\n不要声称这是正式法律意见。\n\n待检查文案：\n${input.source}`
  if (input.mode === 'breakdown') return `你是短视频内容策略师。请拆解下面的参考文案，使用${language}输出清晰报告，必须包含：核心主题、目标受众、开头钩子、内容结构、核心卖点、情绪与节奏、表达技巧、结尾行动引导、可借鉴点、风险与不足。最后给出一个不超过${input.targetLength}字的复用框架。\n\n参考文案：\n${input.source}`
  if (input.mode === 'inspiration') return `你是短视频原创文案策划。参考下面内容的主题与有效表达，但不要照抄句式，生成一篇约${input.targetLength}字的${language}原创口播稿。目标平台：${input.platform || '通用短视频平台'}；受众：${input.audience || '普通用户'}；风格：${input.style || '自然、有吸引力'}；改写强度：${input.rewriteStrength ?? 70}%。要求有开头钩子、清晰价值点和自然结尾，只输出最终文案。\n\n参考内容：\n${input.source}`
  return `你是短视频文案策划。请从零生成一篇约${input.targetLength}字的${language}口播稿。主题：${input.subject || '未指定'}；产品/内容信息：${input.product || '无'}；目标受众：${input.audience || '普通用户'}；发布平台：${input.platform || '通用短视频平台'}；风格：${input.style || '自然、有吸引力'}。要求开头快速抓住注意力，中段提供具体价值，结尾包含自然行动引导。只输出最终文案。`
}
