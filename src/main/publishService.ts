import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, clipboard, safeStorage, shell } from 'electron'
import { getPublishAccount, getPublication, listPublishAccounts, listUnifiedWorks, setPublicationStatus } from './database'

export type PublishAuthorization = { method: 'browser'; browser: 'edge' | 'chrome'; updatedAt: string } | { method: 'cookies'; cookies: string; fileName: string; updatedAt: string }

const creatorUrls: Record<string, string> = {
  抖音: 'https://creator.douyin.com/creator-micro/content/upload',
  小红书: 'https://creator.xiaohongshu.com/publish/publish',
  快手: 'https://cp.kuaishou.com/article/publish/video',
  B站: 'https://member.bilibili.com/platform/upload/video/frame',
  视频号: 'https://channels.weixin.qq.com/platform/post/create',
  公众号: 'https://mp.weixin.qq.com/'
}

const limits: Record<string, { title: number; body: number; images: number }> = {
  小红书: { title: 20, body: 1000, images: 18 },
  公众号: { title: 64, body: 20000, images: 20 },
  抖音: { title: 55, body: 2200, images: 12 },
  视频号: { title: 30, body: 1000, images: 9 }
}

function secretsPath() { return join(app.getPath('userData'), 'secrets', 'publish-accounts.json') }
function readSecrets(): Record<string, string> { try { return existsSync(secretsPath()) ? JSON.parse(readFileSync(secretsPath(), 'utf8')) as Record<string, string> : {} } catch { return {} } }
function writeSecrets(value: Record<string, string>) { const file = secretsPath(); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 }) }
export function savePublishSecret(accountId: number, secret?: string) { if (!secret?.trim()) return; if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，账号凭据未保存'); const values = readSecrets(); values[String(accountId)] = safeStorage.encryptString(secret.trim()).toString('base64'); writeSecrets(values) }
export function removePublishSecret(accountId: number) { const values = readSecrets(); delete values[String(accountId)]; writeSecrets(values) }
export function hasPublishSecret(accountId: number) { return Boolean(readSecrets()[String(accountId)]) }

function decryptPublishSecret(accountId: number) {
  const encrypted = readSecrets()[String(accountId)]
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { return '' }
}

export function getPublishAuthorization(accountId: number): PublishAuthorization | null {
  const raw = decryptPublishSecret(accountId)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PublishAuthorization
    return parsed.method === 'browser' || parsed.method === 'cookies' ? parsed : null
  } catch { return null }
}

export function saveBrowserAuthorization(accountId: number, browser: 'edge' | 'chrome') {
  savePublishSecret(accountId, JSON.stringify({ method: 'browser', browser, updatedAt: new Date().toISOString() } satisfies PublishAuthorization))
  return getAuthorizationSummary(accountId)
}

export function saveCookieAuthorization(accountId: number, cookies: string, fileName: string) {
  if (!cookies.includes('\t') && !/Netscape HTTP Cookie File/i.test(cookies)) throw new Error('请选择 Netscape 格式的 cookies.txt 文件')
  savePublishSecret(accountId, JSON.stringify({ method: 'cookies', cookies, fileName, updatedAt: new Date().toISOString() } satisfies PublishAuthorization))
  return getAuthorizationSummary(accountId)
}

export function clearPublishAuthorization(accountId: number) { removePublishSecret(accountId); return getAuthorizationSummary(accountId) }

function browserUserData(browser: 'edge' | 'chrome') {
  const local = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local')
  return browser === 'edge' ? join(local, 'Microsoft', 'Edge', 'User Data') : join(local, 'Google', 'Chrome', 'User Data')
}

function browserHasCookies(browser: 'edge' | 'chrome') {
  const root = browserUserData(browser)
  if (!existsSync(root)) return false
  try { return readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory() && (item.name === 'Default' || item.name.startsWith('Profile '))).some((item) => existsSync(join(root, item.name, 'Network', 'Cookies')) || existsSync(join(root, item.name, 'Cookies'))) } catch { return false }
}

export function getAuthorizationSummary(accountId: number) {
  const auth = getPublishAuthorization(accountId)
  return { has_secret: Boolean(auth), auth_method: auth?.method ?? '', auth_browser: auth?.method === 'browser' ? auth.browser : '', auth_updated_at: auth?.updatedAt ?? '' }
}

export function testPublishAuthorization(accountId: number) {
  const account = getPublishAccount(accountId)
  if (!account) return { ok: false, message: '账号不存在' }
  if (account.simulation) return { ok: true, message: '模拟发布通道可用' }
  const auth = getPublishAuthorization(accountId)
  if (!auth) return { ok: false, message: '尚未授权，请选择 Edge、Chrome 或导入 cookies.txt' }
  if (auth.method === 'cookies') return { ok: true, message: `已加密保存 Cookie（${auth.fileName}），建议打开官方页面确认是否仍有效` }
  return browserHasCookies(auth.browser)
    ? { ok: true, message: `检测到 ${auth.browser === 'edge' ? 'Edge' : 'Chrome'} 登录数据，请打开官方页面确认平台登录状态` }
    : { ok: false, message: `未找到 ${auth.browser === 'edge' ? 'Edge' : 'Chrome'} 登录数据，请先在浏览器登录平台` }
}

export function openPlatformAuthorization(accountId: number) {
  const account = getPublishAccount(accountId); if (!account) throw new Error('账号不存在')
  const url = creatorUrls[account.platform] || 'https://www.douyin.com/'
  void shell.openExternal(url); return { ok: true, url }
}

export function findPlatformAuthorization(platform: string) {
  const account = listPublishAccounts().find((item) => item.platform === platform && item.enabled && !item.simulation)
  return account ? getPublishAuthorization(account.id) : null
}

export function validatePublication(id: number) {
  const publication = getPublication(id); if (!publication) throw new Error('发布内容不存在')
  const account = getPublishAccount(publication.account_id); if (!account || !account.enabled) return { valid: false, errors: ['发布账号不存在或已停用'], warnings: [] as string[] }
  const rule = limits[publication.platform] ?? { title: 60, body: 5000, images: 20 }
  const errors: string[] = []; const warnings: string[] = []
  if (!publication.title.trim()) errors.push('标题不能为空')
  if (!publication.body.trim()) errors.push('正文不能为空')
  if (publication.title.length > rule.title) errors.push(`${publication.platform}标题不能超过 ${rule.title} 字`)
  if (publication.body.length > rule.body) errors.push(`${publication.platform}正文不能超过 ${rule.body} 字`)
  const workMap = new Map(listUnifiedWorks().map((work) => [work.key, work])); const linked = publication.work_keys.split(',').filter(Boolean).map((key) => workMap.get(key)).filter(Boolean)
  const images = linked.filter((work) => work?.type === 'image')
  const videos = linked.filter((work) => work?.type === 'video')
  if (images.length > rule.images) errors.push(`${publication.platform}最多支持 ${rule.images} 张图片`)
  if ([...images, ...videos].some((work) => work?.file_path && !existsSync(work.file_path))) errors.push('关联作品中存在丢失的媒体文件')
  if (!images.length && !videos.length && (publication.platform === '小红书' || publication.platform === '抖音')) warnings.push(`${publication.platform}内容建议至少添加 1 个图片或视频素材`)
  const sensitive = ['绝对第一', '百分百保证', '国家级', '稳赚', '治愈所有'].filter((word) => `${publication.title}${publication.body}`.includes(word))
  if (sensitive.length) warnings.push(`发现可能需要核验的表述：${sensitive.join('、')}`)
  if (!publication.topics.trim()) warnings.push('尚未添加话题标签')
  return { valid: errors.length === 0, errors, warnings }
}

export async function executePublication(id: number) {
  const publication = getPublication(id); if (!publication) throw new Error('发布内容不存在')
  const validation = validatePublication(id); if (!validation.valid) { const error = validation.errors.join('；'); setPublicationStatus(id, 'failed', error, { error }); throw new Error(error) }
  const account = getPublishAccount(publication.account_id); if (!account) throw new Error('发布账号不存在')
  if (!account.simulation) {
    const auth = getPublishAuthorization(account.id)
    if (!auth) { const error = '账号尚未授权，请先在“渠道账号”中读取浏览器登录状态或导入 Cookie'; setPublicationStatus(id, 'failed', error, { error }); throw new Error(error) }
    const url = creatorUrls[publication.platform]
    if (!url) { const error = `暂未配置 ${publication.platform} 官方创作页`; setPublicationStatus(id, 'failed', error, { error }); throw new Error(error) }
    const works = new Map(listUnifiedWorks().map((work) => [work.key, work])); const linked = publication.work_keys.split(',').filter(Boolean).map((key) => works.get(key)).filter(Boolean)
    const media = linked.find((work) => work?.file_path && existsSync(work.file_path))
    clipboard.writeText([publication.title, publication.body, publication.topics].filter(Boolean).join('\n\n'))
    if (media?.file_path) shell.showItemInFolder(media.file_path)
    await shell.openExternal(url)
    return setPublicationStatus(id, 'publishing', '已打开官方创作页并复制文案，等待人工确认发布结果', { resultUrl: url, error: null })
  }
  setPublicationStatus(id, 'publishing', '正在执行模拟发布')
  await new Promise((resolve) => setTimeout(resolve, 700))
  const publishedAt = new Date().toISOString(); return setPublicationStatus(id, 'published', '模拟发布成功', { resultUrl: `rainbow-publish://${publication.platform}/${id}`, publishedAt })
}
