import { liyingRequest } from '../apiClient'

export interface TtsParams { text: string; voiceId: string; speed?: number; emotion?: string }
export interface TtsResult { audioUrl?: string; audioPath?: string; duration?: number }

export function generateTts(params: TtsParams) {
  return liyingRequest<TtsResult>('/api/tts/generate', {
    method: 'POST',
    body: JSON.stringify({
      text: params.text,
      voice_id: params.voiceId,
      speed: params.speed ?? 1,
      emotion: params.emotion ?? ''
    })
  })
}
