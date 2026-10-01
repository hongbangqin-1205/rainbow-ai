import { TextChatPage } from './TextChatPage'
import { ImageStudioPage } from './ImageStudioPage'

export function StudioPage({ mode, recreate }: { mode: 'text' | 'image'; recreate?: RecreatePayload }) {
  const isText = mode === 'text'
  if (isText) return <TextChatPage recreate={recreate} />
  return <ImageStudioPage recreate={recreate} />
}
