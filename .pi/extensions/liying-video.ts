import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function liyingVideoExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'liying_video_plan', label: '厉影视频任务规划',
    description: '将视频制作目标拆解为文案、配音、字幕和合成步骤。',
    parameters: Type.Object({ prompt: Type.String() }),
    execute: async (_id, params) => ({ content: [{ type: 'text', text: `已建立视频任务：${params.prompt}` }], details: { steps: ['文案', '配音', '字幕', '合成'] } })
  })

  pi.registerTool({
    name: 'generate_tts', label: '厉影生成配音',
    description: '调用厉影 API，根据文案和声音 ID 生成配音。',
    parameters: Type.Object({ text: Type.String(), voiceId: Type.String(), speed: Type.Optional(Type.Number()), emotion: Type.Optional(Type.String()) }),
    execute: async (_id, params) => {
      const { generateTts } = await import('../../src/agent/tools/tts')
      const result = await generateTts(params)
      return { content: [{ type: 'text', text: `配音生成完成：${result.audioUrl || result.audioPath || '已返回结果'}` }], details: result }
    }
  })
}
