const API_BASE = (globalThis as any).process?.env?.LIYING_API_BASE || 'http://localhost:8001'
const API_TOKEN = (globalThis as any).process?.env?.LIYING_API_TOKEN || ''

export async function liyingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { Authorization: API_TOKEN } : {}),
      ...(init.headers || {})
    }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`厉影 API 请求失败：${response.status}`)
  if (data?.code !== undefined && ![0, 1000].includes(data.code)) throw new Error(data.message || '厉影 API 返回错误')
  return data as T
}
