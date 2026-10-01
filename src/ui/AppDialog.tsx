import { useCallback, useEffect, useRef, useState } from 'react'

type ConfirmRequest = { kind: 'confirm'; title: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }
type PromptRequest = { kind: 'prompt'; title: string; message?: string; value?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string; multiline?: boolean }
type DialogRequest = ConfirmRequest | PromptRequest
type DialogResult = boolean | string | null

export type AppDialogController = {
  request: DialogRequest | null
  confirm: (input: Omit<ConfirmRequest, 'kind'>) => Promise<boolean>
  prompt: (input: Omit<PromptRequest, 'kind'>) => Promise<string | null>
  settle: (result: DialogResult) => void
}

export function useAppDialog(): AppDialogController {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const resolver = useRef<((result: DialogResult) => void) | null>(null)
  const open = useCallback((next: DialogRequest) => new Promise<DialogResult>((resolve) => { resolver.current?.(null); resolver.current = resolve; setRequest(next) }), [])
  const settle = useCallback((result: DialogResult) => { const resolve = resolver.current; resolver.current = null; setRequest(null); resolve?.(result) }, [])
  const confirm = useCallback((input: Omit<ConfirmRequest, 'kind'>) => open({ kind: 'confirm', ...input }).then(Boolean), [open])
  const prompt = useCallback((input: Omit<PromptRequest, 'kind'>) => open({ kind: 'prompt', ...input }).then((result) => typeof result === 'string' ? result : null), [open])
  useEffect(() => () => resolver.current?.(null), [])
  return { request, confirm, prompt, settle }
}

export function AppDialog({ controller }: { controller: AppDialogController }) {
  const { request, settle } = controller
  const [value, setValue] = useState('')
  useEffect(() => { if (request?.kind === 'prompt') setValue(request.value ?? '') }, [request])
  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') settle(request.kind === 'confirm' ? false : null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [request, settle])
  if (!request) return null
  const submit = () => request.kind === 'confirm' ? settle(true) : settle(value.trim())
  return <div className="app-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) settle(request.kind === 'confirm' ? false : null) }}>
    <section className={`app-dialog panel ${request.kind === 'confirm' && request.tone === 'danger' ? 'danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
      <header><div><span>{request.kind === 'confirm' ? 'CONFIRM ACTION' : 'EDIT CONTENT'}</span><h2 id="app-dialog-title">{request.title}</h2></div><button aria-label="关闭弹窗" onClick={() => settle(request.kind === 'confirm' ? false : null)}>×</button></header>
      {request.message && <p>{request.message}</p>}
      {request.kind === 'prompt' && (request.multiline ? <textarea autoFocus value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} /> : <input autoFocus value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />)}
      <footer><button className="outline-button" onClick={() => settle(request.kind === 'confirm' ? false : null)}>{request.cancelLabel ?? '取消'}</button><button className={request.kind === 'confirm' && request.tone === 'danger' ? 'dialog-danger-button' : 'gradient-button'} disabled={request.kind === 'prompt' && !value.trim()} onClick={submit}>{request.confirmLabel ?? '确认'}</button></footer>
    </section>
  </div>
}
