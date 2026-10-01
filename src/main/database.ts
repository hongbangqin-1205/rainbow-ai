import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { App } from 'electron'
import { getStorageConfig, getStorageRoot } from './storageService'

type ProjectRow = { id: number; name: string; description: string; created_at: string }
export type TaskRow = { id: number; project_id: number; title: string; schedule: string; status: string; enabled: number; created_at: string; last_run_at: string | null; next_run_at: string | null }
type RunRow = { id: number; task_id: number; task_title: string; status: string; output: string | null; error: string | null; started_at: string; finished_at: string | null }
export type ModelConfigRow = { provider: string; base_url: string; api_protocol: 'responses' | 'chat_completions' | 'claude_messages'; text_model: string; image_model: string; video_model: string; voice_model: string; asr_model: string; default_model: string; temperature: number; max_tokens: number; timeout_seconds: number; retry_count: number; updated_at: string }
export type ConversationRow = { id: number; title: string; provider: string; model: string; created_at: string; updated_at: string }
export type MessageRow = { id: number; conversation_id: number; role: 'user' | 'assistant'; content: string; status: string; error: string | null; created_at: string }
export type AgentRunRow = { id: number; request_id: string; conversation_id: number; provider: string; model: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; summary: string; error: string | null; started_at: string; finished_at: string | null }
export type AgentStepRow = { id: number; run_id: number; tool_call_id: string; tool_name: string; label: string; risk: 'read' | 'write' | 'system'; status: 'running' | 'completed' | 'failed'; input: string; output: string; error: string | null; started_at: string; finished_at: string | null }
export type TextWorkRow = { id: number; title: string; content: string; conversation_id: number | null; created_at: string }
export type ImageWorkRow = { id: number; prompt: string; provider: string; model: string; size: string; quality: string; file_path: string; mime_type: string; revised_prompt: string | null; created_at: string }
export type AudioWorkRow = { id: number; title: string; prompt: string; provider: string; model: string; voice: string; speed: number; file_path: string; mime_type: string; video_project_id: number | null; created_at: string }
export type VideoWorkRow = { id: number; title: string; prompt: string; provider: string; model: string; ratio: string; resolution: string; duration: number; file_path: string; mime_type: string; video_project_id: number | null; source_image_path: string; created_at: string }
export type WorkType = 'text' | 'image' | 'video' | 'audio'
export type UnifiedWorkRow = { key: string; id: number; type: WorkType; title: string; content: string; prompt: string; provider: string; model: string; size: string; quality: string; file_path: string; mime_type: string; conversation_id: number | null; created_at: string; updated_at: string; favorite: number; tags: string; project_ids: string; missing: number }
export type WorksPageInput = { page?: number; pageSize?: number; kind?: 'all' | WorkType; query?: string; provider?: string; model?: string; time?: string; projectId?: number }
export type WorksPageResult = { items: UnifiedWorkRow[]; total: number; page: number; pageSize: number; counts: Record<'all' | WorkType, number>; providers: string[]; models: string[]; latest: string }
export type PublishAccountRow = { id: number; platform: string; name: string; handle: string; enabled: number; simulation: number; created_at: string; updated_at: string }
export type PublicationRow = { id: number; account_id: number; platform: string; account_name: string; project_id: number | null; project_name: string; title: string; body: string; topics: string; status: string; scheduled_at: string | null; published_at: string | null; result_url: string | null; error: string | null; work_keys: string; created_at: string; updated_at: string }
export type VideoProjectRow = { id: number; title: string; mode: string; language: string; target_length: number; draft: string; created_at: string; updated_at: string }
export type VideoSourceRow = { id: number; video_project_id: number; source_type: 'url' | 'file' | 'text'; source_value: string; display_name: string; platform: string; status: string; duration: number | null; file_size: number | null; error: string | null; created_at: string; updated_at: string }
export type VideoTranscriptRow = { id: number; source_id: number; engine: string; language: string; content: string; status: string; error: string | null; created_at: string; updated_at: string }
export type VideoGenerationRow = { id: number; video_project_id: number; kind: string; mode: string; content: string; provider: string; model: string; parameters: string; created_at: string }
export type VoiceSampleRow = { id: number; name: string; file_path: string; mime_type: string; file_size: number; source_type: 'recording' | 'upload'; authorized: number; created_at: string; updated_at: string }
export type DigitalHumanTaskRow = { id: number; request_id: string; fingerprint: string; upstream_task_id: string; video_project_id: number | null; title: string; prompt: string; image_path: string; provider: string; model: string; ratio: string; resolution: string; duration: number; motion: string; status: string; progress: number; message: string; result_url: string; file_path: string; video_work_id: number | null; error: string | null; created_at: string; updated_at: string }

let database: DatabaseSync | null = null

export function openDatabase(electronApp: App) {
  const directory = join(getStorageRoot(electronApp), 'data')
  mkdirSync(directory, { recursive: true })
  database = new DatabaseSync(join(directory, 'rainbow.db'))
  database.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL, schedule TEXT NOT NULL DEFAULT '手动执行', status TEXT NOT NULL DEFAULT '待执行', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_run_at TEXT, next_run_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, status TEXT NOT NULL, output TEXT, error TEXT, started_at TEXT NOT NULL, finished_at TEXT, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS model_configs (provider TEXT PRIMARY KEY, base_url TEXT NOT NULL, api_protocol TEXT NOT NULL DEFAULT 'chat_completions', text_model TEXT NOT NULL DEFAULT '', image_model TEXT NOT NULL DEFAULT '', video_model TEXT NOT NULL DEFAULT '', voice_model TEXT NOT NULL DEFAULT '', asr_model TEXT NOT NULL DEFAULT '', default_model TEXT NOT NULL DEFAULT '', temperature REAL NOT NULL DEFAULT 0.7, max_tokens INTEGER NOT NULL DEFAULT 4096, timeout_seconds INTEGER NOT NULL DEFAULT 60, retry_count INTEGER NOT NULL DEFAULT 2, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'completed', error TEXT, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, conversation_id INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', summary TEXT NOT NULL DEFAULT '', error TEXT, started_at TEXT NOT NULL, finished_at TEXT, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS agent_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, label TEXT NOT NULL, risk TEXT NOT NULL DEFAULT 'read', status TEXT NOT NULL DEFAULT 'running', input TEXT NOT NULL DEFAULT '{}', output TEXT NOT NULL DEFAULT '', error TEXT, started_at TEXT NOT NULL, finished_at TEXT, FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE, UNIQUE(run_id, tool_call_id));
    CREATE TABLE IF NOT EXISTS text_works (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, conversation_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS image_works (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, size TEXT NOT NULL, quality TEXT NOT NULL, file_path TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'image/png', revised_prompt TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audio_works (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, model TEXT NOT NULL, voice TEXT NOT NULL DEFAULT '', speed REAL NOT NULL DEFAULT 1, file_path TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'audio/mpeg', video_project_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(video_project_id) REFERENCES video_projects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS video_works (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, model TEXT NOT NULL, ratio TEXT NOT NULL DEFAULT '9:16', resolution TEXT NOT NULL DEFAULT '720p', duration INTEGER NOT NULL DEFAULT 5, file_path TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'video/mp4', video_project_id INTEGER, source_image_path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(video_project_id) REFERENCES video_projects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS work_metadata (work_type TEXT NOT NULL, work_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(work_type, work_id));
    CREATE TABLE IF NOT EXISTS work_projects (work_type TEXT NOT NULL, work_id INTEGER NOT NULL, project_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(work_type, work_id, project_id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS work_tasks (work_type TEXT NOT NULL, work_id INTEGER NOT NULL, task_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(work_type, work_id, task_id), FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS publish_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, name TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, simulation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publications (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, project_id INTEGER, title TEXT NOT NULL, body TEXT NOT NULL, topics TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', scheduled_at TEXT, published_at TEXT, result_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES publish_accounts(id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS publication_works (publication_id INTEGER NOT NULL, work_type TEXT NOT NULL, work_id INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(publication_id, work_type, work_id), FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS publication_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, publication_id INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE);`)
  database.exec(`CREATE TABLE IF NOT EXISTS video_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'inspiration', language TEXT NOT NULL DEFAULT 'zh', target_length INTEGER NOT NULL DEFAULT 100, draft TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS video_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, video_project_id INTEGER NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('url', 'file', 'text')), source_value TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ready', duration REAL, file_size INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS video_transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL UNIQUE, engine TEXT NOT NULL DEFAULT 'whisper-small', language TEXT NOT NULL DEFAULT 'zh', content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(source_id) REFERENCES video_sources(id) ON DELETE CASCADE);`)
  database.exec(`CREATE TABLE IF NOT EXISTS video_generations (id INTEGER PRIMARY KEY AUTOINCREMENT, video_project_id INTEGER NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', parameters TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE);`)
  database.exec(`CREATE TABLE IF NOT EXISTS voice_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, file_path TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, source_type TEXT NOT NULL CHECK(source_type IN ('recording', 'upload')), authorized INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`)
  database.exec(`CREATE TABLE IF NOT EXISTS digital_human_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL DEFAULT '', upstream_task_id TEXT NOT NULL DEFAULT '', video_project_id INTEGER, title TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT 'DMXAPI', model TEXT NOT NULL DEFAULT '', ratio TEXT NOT NULL DEFAULT '9:16', resolution TEXT NOT NULL DEFAULT '720p', duration INTEGER NOT NULL DEFAULT 5, motion TEXT NOT NULL DEFAULT 'natural', status TEXT NOT NULL DEFAULT 'submitting', progress INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', result_url TEXT NOT NULL DEFAULT '', file_path TEXT NOT NULL DEFAULT '', video_work_id INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(video_project_id) REFERENCES video_projects(id) ON DELETE SET NULL, FOREIGN KEY(video_work_id) REFERENCES video_works(id) ON DELETE SET NULL); CREATE INDEX IF NOT EXISTS idx_digital_human_tasks_project ON digital_human_tasks(video_project_id, id DESC); CREATE INDEX IF NOT EXISTS idx_digital_human_tasks_fingerprint ON digital_human_tasks(fingerprint, status);`)
  try { database.exec('ALTER TABLE tasks ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1') } catch {}
  try { database.exec('ALTER TABLE tasks ADD COLUMN next_run_at TEXT') } catch {}
  try { database.exec('ALTER TABLE task_runs ADD COLUMN error TEXT') } catch {}
  try { database.exec("ALTER TABLE model_configs ADD COLUMN api_protocol TEXT NOT NULL DEFAULT 'chat_completions'") } catch {}
  try { database.exec("ALTER TABLE model_configs ADD COLUMN asr_model TEXT NOT NULL DEFAULT ''") } catch {}
  database.exec("UPDATE model_configs SET asr_model = 'gpt-4o-mini-transcribe' WHERE provider IN ('OpenAI', '极客智坊') AND asr_model = ''")
  database.exec("UPDATE model_configs SET video_model = 'doubao-seedance-2-0-260128' WHERE provider = 'DMXAPI' AND video_model = ''")
  database.exec("UPDATE model_configs SET api_protocol = 'responses' WHERE provider = 'OpenAI' AND api_protocol = 'chat_completions'")
  database.exec("UPDATE model_configs SET api_protocol = 'claude_messages' WHERE provider = 'Claude' AND api_protocol = 'chat_completions'")
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec(`CREATE INDEX IF NOT EXISTS idx_text_works_created ON text_works(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_image_works_created ON image_works(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audio_works_created ON audio_works(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_works_created ON video_works(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_metadata_updated ON work_metadata(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_projects_project ON work_projects(project_id, work_type, work_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, id ASC);`)
  const storageConfig = getStorageConfig(electronApp)
  if (storageConfig?.previousRoot && storageConfig.previousRoot !== storageConfig.root) database.prepare("UPDATE image_works SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?").run(storageConfig.previousRoot, storageConfig.root, `${storageConfig.previousRoot}%`)
  if (storageConfig?.previousRoot && storageConfig.previousRoot !== storageConfig.root) database.prepare("UPDATE audio_works SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?").run(storageConfig.previousRoot, storageConfig.root, `${storageConfig.previousRoot}%`)
  if (storageConfig?.previousRoot && storageConfig.previousRoot !== storageConfig.root) database.prepare("UPDATE video_works SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?").run(storageConfig.previousRoot, storageConfig.root, `${storageConfig.previousRoot}%`)
  if (storageConfig?.previousRoot && storageConfig.previousRoot !== storageConfig.root) database.prepare("UPDATE voice_samples SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?").run(storageConfig.previousRoot, storageConfig.root, `${storageConfig.previousRoot}%`)
  if (storageConfig?.previousRoot && storageConfig.previousRoot !== storageConfig.root) database.prepare("UPDATE digital_human_tasks SET file_path = REPLACE(file_path, ?, ?), image_path = REPLACE(image_path, ?, ?) WHERE file_path LIKE ? OR image_path LIKE ?").run(storageConfig.previousRoot, storageConfig.root, storageConfig.previousRoot, storageConfig.root, `${storageConfig.previousRoot}%`, `${storageConfig.previousRoot}%`)
  const count = database.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }
  if (count.count === 0) {
    const now = new Date().toISOString()
    const insert = database.prepare('INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)')
    insert.run('小红书账号运营', '每周产出 3 条内容', now)
    insert.run('每周视频生产', '固定的视频生产流程', now)
    insert.run('品牌素材整理', '沉淀品牌图片和文案', now)
  }
  const accountCount = database.prepare('SELECT COUNT(*) AS count FROM publish_accounts').get() as { count: number }
  if (accountCount.count === 0) {
    const now = new Date().toISOString(); const insert = database.prepare('INSERT INTO publish_accounts (platform, name, handle, enabled, simulation, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
    insert.run('小红书', '小红书模拟账号', '@rainbow_demo', now, now); insert.run('公众号', '公众号模拟账号', 'Rainbow AI', now, now); insert.run('抖音', '抖音模拟账号', '@rainbow_demo', now, now); insert.run('视频号', '视频号模拟账号', 'Rainbow AI', now, now)
  }
}

function db() { if (!database) throw new Error('数据库尚未初始化'); return database }
export function checkpointDatabase() { db().exec('PRAGMA wal_checkpoint(FULL)') }
export function listProjects() { return db().prepare('SELECT * FROM projects ORDER BY id ASC').all() as unknown as ProjectRow[] }
export function createProject(name: string, description = '') { const result = db().prepare('INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)').run(name, description, new Date().toISOString()); return db().prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as unknown as ProjectRow }
export function updateProject(id: number, name: string, description = '') { db().prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(name, description, id); return db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow }
export function deleteProject(id: number) { db().prepare('DELETE FROM projects WHERE id = ?').run(id) }
export function listTasks(projectId: number) { return db().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC').all(projectId) as unknown as TaskRow[] }
export function nextRunFor(schedule: string, from = new Date()) {
  const next = new Date(from)
  if (schedule.startsWith('每天')) {
    const match = schedule.match(/(\d{1,2}):(\d{2})/); if (!match) return null
    next.setHours(Number(match[1]), Number(match[2]), 0, 0); if (next <= from) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  if (schedule.startsWith('每周')) {
    const weekdays: Record<string, number> = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
    const match = schedule.match(/每周([日一二三四五六]).*?(\d{1,2}):(\d{2})/); if (!match) return null
    const days = (weekdays[match[1]] - next.getDay() + 7) % 7
    next.setDate(next.getDate() + days); next.setHours(Number(match[2]), Number(match[3]), 0, 0); if (next <= from) next.setDate(next.getDate() + 7)
    return next.toISOString()
  }
  return null
}
export function createTask(projectId: number, title: string, schedule = '手动执行') { const result = db().prepare('INSERT INTO tasks (project_id, title, schedule, status, enabled, created_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(projectId, title, schedule, '待执行', 1, new Date().toISOString(), nextRunFor(schedule)); return db().prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as unknown as TaskRow }
export function updateTask(id: number, title: string, schedule: string, status: string, enabled = true) { db().prepare('UPDATE tasks SET title = ?, schedule = ?, status = ?, enabled = ?, next_run_at = ? WHERE id = ?').run(title, schedule, status, enabled ? 1 : 0, enabled ? nextRunFor(schedule) : null, id); return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow }
export function deleteTask(id: number) { db().prepare('DELETE FROM tasks WHERE id = ?').run(id) }
export function runTask(id: number) { const start = new Date().toISOString(); db().prepare('UPDATE tasks SET status = ?, last_run_at = ? WHERE id = ?').run('执行中', start, id); const result = db().prepare('INSERT INTO task_runs (task_id, status, started_at) VALUES (?, ?, ?)').run(id, '执行中', start); return { runId: Number(result.lastInsertRowid), startedAt: start } }
export function finishTask(runId: number, taskId: number) { const finished = new Date().toISOString(); const task = db().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as unknown as TaskRow; db().prepare('UPDATE task_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?').run('已完成', '任务已完成，等待查看结果', finished, runId); db().prepare('UPDATE tasks SET status = ?, last_run_at = ?, next_run_at = ? WHERE id = ?').run('已完成', finished, task.enabled ? nextRunFor(task.schedule, new Date(finished)) : null, taskId); return { status: '已完成', finishedAt: finished } }
export function failTask(runId: number, taskId: number, error: string) { const finished = new Date().toISOString(); const task = db().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as unknown as TaskRow; db().prepare('UPDATE task_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run('失败', error, finished, runId); db().prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('失败', task.enabled ? nextRunFor(task.schedule, new Date(finished)) : null, taskId) }
export function listRuns(projectId: number) { return db().prepare('SELECT task_runs.*, tasks.title AS task_title FROM task_runs JOIN tasks ON tasks.id = task_runs.task_id WHERE tasks.project_id = ? ORDER BY task_runs.id DESC').all(projectId) as unknown as RunRow[] }
export function listDueTasks(now = new Date().toISOString()) { return db().prepare("SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? AND status != '执行中' ORDER BY next_run_at ASC").all(now) as unknown as TaskRow[] }

export function listVideoProjects() { return db().prepare('SELECT * FROM video_projects ORDER BY updated_at DESC').all() as unknown as VideoProjectRow[] }
export function createVideoProject(title = '未命名视频项目') { const now = new Date().toISOString(); const result = db().prepare('INSERT INTO video_projects (title, created_at, updated_at) VALUES (?, ?, ?)').run(title, now, now); return getVideoProject(Number(result.lastInsertRowid))! }
export function getVideoProject(id: number) { return db().prepare('SELECT * FROM video_projects WHERE id = ?').get(id) as unknown as VideoProjectRow | undefined }
export function updateVideoProject(id: number, input: { title: string; mode: string; language: string; targetLength: number; draft: string }) { const now = new Date().toISOString(); db().prepare('UPDATE video_projects SET title = ?, mode = ?, language = ?, target_length = ?, draft = ?, updated_at = ? WHERE id = ?').run(input.title, input.mode, input.language, input.targetLength, input.draft, now, id); return getVideoProject(id) }
export function listVideoSources(projectId: number) { return db().prepare('SELECT * FROM video_sources WHERE video_project_id = ? ORDER BY id DESC').all(projectId) as unknown as VideoSourceRow[] }
export function getVideoSource(id: number) { return db().prepare('SELECT * FROM video_sources WHERE id = ?').get(id) as unknown as VideoSourceRow | undefined }
export function createVideoSource(projectId: number, input: { sourceType: 'url' | 'file' | 'text'; sourceValue: string; displayName: string; platform?: string; status?: string; duration?: number | null; fileSize?: number | null; error?: string | null }) { const now = new Date().toISOString(); const result = db().prepare('INSERT INTO video_sources (video_project_id, source_type, source_value, display_name, platform, status, duration, file_size, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(projectId, input.sourceType, input.sourceValue, input.displayName, input.platform ?? '', input.status ?? 'ready', input.duration ?? null, input.fileSize ?? null, input.error ?? null, now, now); db().prepare('UPDATE video_projects SET updated_at = ? WHERE id = ?').run(now, projectId); return db().prepare('SELECT * FROM video_sources WHERE id = ?').get(result.lastInsertRowid) as unknown as VideoSourceRow }
export function deleteVideoSource(id: number) { db().prepare('DELETE FROM video_sources WHERE id = ?').run(id) }
export function setVideoSourceStatus(id: number, status: string, error: string | null = null) { db().prepare('UPDATE video_sources SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, new Date().toISOString(), id); return db().prepare('SELECT * FROM video_sources WHERE id = ?').get(id) as unknown as VideoSourceRow }
export function getVideoTranscript(sourceId: number) { return db().prepare('SELECT * FROM video_transcripts WHERE source_id = ?').get(sourceId) as unknown as VideoTranscriptRow | undefined }
export function saveVideoTranscript(sourceId: number, input: { engine: string; language: string; content: string; status: string; error?: string | null }) { const now = new Date().toISOString(); db().prepare(`INSERT INTO video_transcripts (source_id, engine, language, content, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET engine = excluded.engine, language = excluded.language, content = excluded.content, status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`).run(sourceId, input.engine, input.language, input.content, input.status, input.error ?? null, now, now); return getVideoTranscript(sourceId)! }
export function listVideoGenerations(projectId: number) { return db().prepare('SELECT * FROM video_generations WHERE video_project_id = ? ORDER BY id DESC').all(projectId) as unknown as VideoGenerationRow[] }
export function saveVideoGeneration(projectId: number, input: { kind: string; mode: string; content: string; provider: string; model: string; parameters?: string }) { const result = db().prepare('INSERT INTO video_generations (video_project_id, kind, mode, content, provider, model, parameters, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(projectId, input.kind, input.mode, input.content, input.provider, input.model, input.parameters ?? '{}', new Date().toISOString()); return db().prepare('SELECT * FROM video_generations WHERE id = ?').get(result.lastInsertRowid) as unknown as VideoGenerationRow }
export function deleteVideoGeneration(id: number) { db().prepare('DELETE FROM video_generations WHERE id = ?').run(id) }
export function listVoiceSamples() { return db().prepare('SELECT * FROM voice_samples ORDER BY id DESC').all() as unknown as VoiceSampleRow[] }
export function getVoiceSample(id: number) { return db().prepare('SELECT * FROM voice_samples WHERE id = ?').get(id) as unknown as VoiceSampleRow | undefined }
export function createVoiceSample(input: { name: string; filePath: string; mimeType: string; fileSize: number; sourceType: 'recording' | 'upload'; authorized: boolean }) { const now = new Date().toISOString(); const result = db().prepare('INSERT INTO voice_samples (name, file_path, mime_type, file_size, source_type, authorized, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(input.name, input.filePath, input.mimeType, input.fileSize, input.sourceType, input.authorized ? 1 : 0, now, now); return getVoiceSample(Number(result.lastInsertRowid))! }
export function renameVoiceSample(id: number, name: string) { db().prepare('UPDATE voice_samples SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id); return getVoiceSample(id) }
export function deleteVoiceSample(id: number) { const row = getVoiceSample(id); db().prepare('DELETE FROM voice_samples WHERE id = ?').run(id); return row }
export function listDigitalHumanTasks(projectId?: number) { return (projectId ? db().prepare('SELECT * FROM digital_human_tasks WHERE video_project_id = ? ORDER BY id DESC LIMIT 30').all(projectId) : db().prepare('SELECT * FROM digital_human_tasks ORDER BY id DESC LIMIT 30').all()) as unknown as DigitalHumanTaskRow[] }
export function getDigitalHumanTask(id: number) { return db().prepare('SELECT * FROM digital_human_tasks WHERE id = ?').get(id) as unknown as DigitalHumanTaskRow | undefined }
export function getDigitalHumanTaskByRequestId(requestId: string) { return db().prepare('SELECT * FROM digital_human_tasks WHERE request_id = ?').get(requestId) as unknown as DigitalHumanTaskRow | undefined }
export function getDigitalHumanTaskByUpstreamId(upstreamTaskId: string) { return db().prepare('SELECT * FROM digital_human_tasks WHERE upstream_task_id = ? ORDER BY id DESC LIMIT 1').get(upstreamTaskId) as unknown as DigitalHumanTaskRow | undefined }
export function findActiveDigitalHumanTask(fingerprint: string) { return db().prepare("SELECT * FROM digital_human_tasks WHERE fingerprint = ? AND status IN ('submitting','submitted','querying','local_stopped') AND updated_at >= ? ORDER BY id DESC LIMIT 1").get(fingerprint, new Date(Date.now() - 10 * 60 * 1000).toISOString()) as unknown as DigitalHumanTaskRow | undefined }
export function createDigitalHumanTask(input: Omit<DigitalHumanTaskRow, 'id' | 'upstream_task_id' | 'status' | 'progress' | 'message' | 'result_url' | 'file_path' | 'video_work_id' | 'error' | 'created_at' | 'updated_at'> & { upstreamTaskId?: string; status?: string }) { const now = new Date().toISOString(); const result = db().prepare('INSERT INTO digital_human_tasks (request_id, fingerprint, upstream_task_id, video_project_id, title, prompt, image_path, provider, model, ratio, resolution, duration, motion, status, progress, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(input.request_id, input.fingerprint, input.upstreamTaskId ?? '', input.video_project_id, input.title, input.prompt, input.image_path, input.provider, input.model, input.ratio, input.resolution, input.duration, input.motion, input.status ?? 'submitting', input.status === 'submitted' ? 15 : 1, input.status === 'submitted' ? '已关联后台任务，等待查询' : '正在准备提交', now, now); return getDigitalHumanTask(Number(result.lastInsertRowid))! }
export function updateDigitalHumanTask(id: number, input: Partial<Pick<DigitalHumanTaskRow, 'upstream_task_id' | 'status' | 'progress' | 'message' | 'result_url' | 'file_path' | 'video_work_id' | 'error'>>) { const current = getDigitalHumanTask(id); if (!current) throw new Error('数字人生成任务不存在'); const next = { ...current, ...input, updated_at: new Date().toISOString() }; db().prepare('UPDATE digital_human_tasks SET upstream_task_id = ?, status = ?, progress = ?, message = ?, result_url = ?, file_path = ?, video_work_id = ?, error = ?, updated_at = ? WHERE id = ?').run(next.upstream_task_id, next.status, next.progress, next.message, next.result_url, next.file_path, next.video_work_id, next.error, next.updated_at, id); return getDigitalHumanTask(id)! }

export function getModelConfig(provider: string) {
  return db().prepare('SELECT * FROM model_configs WHERE provider = ?').get(provider) as unknown as ModelConfigRow | undefined
}

export function saveModelConfig(config: Omit<ModelConfigRow, 'updated_at'>) {
  const updatedAt = new Date().toISOString()
  db().prepare(`INSERT INTO model_configs (provider, base_url, api_protocol, text_model, image_model, video_model, voice_model, asr_model, default_model, temperature, max_tokens, timeout_seconds, retry_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, api_protocol = excluded.api_protocol, text_model = excluded.text_model, image_model = excluded.image_model, video_model = excluded.video_model, voice_model = excluded.voice_model, asr_model = excluded.asr_model, default_model = excluded.default_model, temperature = excluded.temperature, max_tokens = excluded.max_tokens, timeout_seconds = excluded.timeout_seconds, retry_count = excluded.retry_count, updated_at = excluded.updated_at`)
    .run(config.provider, config.base_url, config.api_protocol, config.text_model, config.image_model, config.video_model, config.voice_model, config.asr_model, config.default_model, config.temperature, config.max_tokens, config.timeout_seconds, config.retry_count, updatedAt)
  return getModelConfig(config.provider)!
}

export function listModelConfigs() { return db().prepare('SELECT * FROM model_configs ORDER BY updated_at DESC').all() as unknown as ModelConfigRow[] }

export function listConversations() { return db().prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as unknown as ConversationRow[] }
export function createConversation(title: string, provider: string, model: string) {
  const now = new Date().toISOString()
  const result = db().prepare('INSERT INTO conversations (title, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(title, provider, model, now, now)
  return db().prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid) as unknown as ConversationRow
}
export function updateConversation(id: number, title: string, provider?: string, model?: string) {
  const current = db().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as ConversationRow
  if (!current) throw new Error('对话不存在')
  db().prepare('UPDATE conversations SET title = ?, provider = ?, model = ?, updated_at = ? WHERE id = ?').run(title, provider ?? current.provider, model ?? current.model, new Date().toISOString(), id)
  return db().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as ConversationRow
}
export function touchConversation(id: number, provider: string, model: string) { db().prepare('UPDATE conversations SET provider = ?, model = ?, updated_at = ? WHERE id = ?').run(provider, model, new Date().toISOString(), id) }
export function deleteConversation(id: number) { db().prepare('DELETE FROM conversations WHERE id = ?').run(id) }
export function listMessages(conversationId: number) { return db().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(conversationId) as unknown as MessageRow[] }
export function addMessage(conversationId: number, role: 'user' | 'assistant', content: string, status = 'completed') {
  const result = db().prepare('INSERT INTO messages (conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?)').run(conversationId, role, content, status, new Date().toISOString())
  return db().prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as unknown as MessageRow
}
export function updateMessage(id: number, content: string, status: string, error?: string | null) {
  db().prepare('UPDATE messages SET content = ?, status = ?, error = ? WHERE id = ?').run(content, status, error ?? null, id)
  return db().prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow
}
export function deleteMessage(id: number) { db().prepare('DELETE FROM messages WHERE id = ?').run(id) }
export function createAgentRun(requestId: string, conversationId: number, provider: string, model: string) {
  const result = db().prepare("INSERT INTO agent_runs (request_id, conversation_id, provider, model, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)").run(requestId, conversationId, provider, model, new Date().toISOString())
  return db().prepare('SELECT * FROM agent_runs WHERE id = ?').get(result.lastInsertRowid) as unknown as AgentRunRow
}
export function finishAgentRun(id: number, status: AgentRunRow['status'], summary: string, error?: string | null) {
  db().prepare('UPDATE agent_runs SET status = ?, summary = ?, error = ?, finished_at = ? WHERE id = ?').run(status, summary, error ?? null, new Date().toISOString(), id)
}
export function startAgentStep(runId: number, toolCallId: string, toolName: string, label: string, risk: AgentStepRow['risk'], input: unknown) {
  const now = new Date().toISOString()
  db().prepare("INSERT INTO agent_steps (run_id, tool_call_id, tool_name, label, risk, status, input, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?) ON CONFLICT(run_id, tool_call_id) DO UPDATE SET risk = excluded.risk, status = 'running', input = excluded.input, error = NULL, finished_at = NULL").run(runId, toolCallId, toolName, label, risk, JSON.stringify(input ?? {}), now)
  return db().prepare('SELECT * FROM agent_steps WHERE run_id = ? AND tool_call_id = ?').get(runId, toolCallId) as unknown as AgentStepRow
}
export function finishAgentStep(runId: number, toolCallId: string, output: unknown, isError: boolean) {
  const serialized = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  db().prepare('UPDATE agent_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE run_id = ? AND tool_call_id = ?').run(isError ? 'failed' : 'completed', serialized.slice(0, 12000), isError ? serialized.slice(0, 1000) : null, new Date().toISOString(), runId, toolCallId)
  return db().prepare('SELECT * FROM agent_steps WHERE run_id = ? AND tool_call_id = ?').get(runId, toolCallId) as unknown as AgentStepRow
}
export function listAgentRuns(conversationId: number) {
  const runs = db().prepare('SELECT * FROM agent_runs WHERE conversation_id = ? ORDER BY id DESC LIMIT 20').all(conversationId) as unknown as AgentRunRow[]
  const steps = db().prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY id ASC')
  return runs.map((run) => ({ ...run, steps: steps.all(run.id) as unknown as AgentStepRow[] }))
}
export function saveTextWork(title: string, content: string, conversationId?: number) {
  const result = db().prepare('INSERT INTO text_works (title, content, conversation_id, created_at) VALUES (?, ?, ?, ?)').run(title, content, conversationId ?? null, new Date().toISOString())
  return db().prepare('SELECT * FROM text_works WHERE id = ?').get(result.lastInsertRowid) as unknown as TextWorkRow
}
export function listTextWorks() { return db().prepare('SELECT * FROM text_works ORDER BY id DESC').all() as unknown as TextWorkRow[] }
export function saveImageWork(work: Omit<ImageWorkRow, 'id' | 'created_at'>) {
  const result = db().prepare('INSERT INTO image_works (prompt, provider, model, size, quality, file_path, mime_type, revised_prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(work.prompt, work.provider, work.model, work.size, work.quality, work.file_path, work.mime_type, work.revised_prompt, new Date().toISOString())
  return db().prepare('SELECT * FROM image_works WHERE id = ?').get(result.lastInsertRowid) as unknown as ImageWorkRow
}
export function listImageWorks(limit = 30) { return db().prepare('SELECT * FROM image_works ORDER BY id DESC LIMIT ?').all(limit) as unknown as ImageWorkRow[] }
export function getImageWork(id: number) { return db().prepare('SELECT * FROM image_works WHERE id = ?').get(id) as unknown as ImageWorkRow | undefined }
export function saveAudioWork(work: Omit<AudioWorkRow, 'id' | 'created_at'>) { const result = db().prepare('INSERT INTO audio_works (title, prompt, provider, model, voice, speed, file_path, mime_type, video_project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(work.title, work.prompt, work.provider, work.model, work.voice, work.speed, work.file_path, work.mime_type, work.video_project_id, new Date().toISOString()); return db().prepare('SELECT * FROM audio_works WHERE id = ?').get(result.lastInsertRowid) as unknown as AudioWorkRow }
export function listAudioWorks(limit = 50) { return db().prepare('SELECT * FROM audio_works ORDER BY id DESC LIMIT ?').all(limit) as unknown as AudioWorkRow[] }
export function getAudioWork(id: number) { return db().prepare('SELECT * FROM audio_works WHERE id = ?').get(id) as unknown as AudioWorkRow | undefined }
export function saveVideoWork(work: Omit<VideoWorkRow, 'id' | 'created_at'>) { const result = db().prepare('INSERT INTO video_works (title, prompt, provider, model, ratio, resolution, duration, file_path, mime_type, video_project_id, source_image_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(work.title, work.prompt, work.provider, work.model, work.ratio, work.resolution, work.duration, work.file_path, work.mime_type, work.video_project_id, work.source_image_path, new Date().toISOString()); return db().prepare('SELECT * FROM video_works WHERE id = ?').get(result.lastInsertRowid) as unknown as VideoWorkRow }
export function listVideoWorks(limit = 50) { return db().prepare('SELECT * FROM video_works ORDER BY id DESC LIMIT ?').all(limit) as unknown as VideoWorkRow[] }
export function getVideoWork(id: number) { return db().prepare('SELECT * FROM video_works WHERE id = ?').get(id) as unknown as VideoWorkRow | undefined }

const unifiedWorksSql = `
  SELECT 'text' AS type, tw.id, COALESCE(NULLIF(wm.title, ''), tw.title) AS title, tw.content, COALESCE((SELECT content FROM messages WHERE conversation_id = tw.conversation_id AND role = 'user' ORDER BY id DESC LIMIT 1), tw.title) AS prompt, COALESCE(c.provider, '') AS provider, COALESCE(c.model, '') AS model, '' AS size, '' AS quality, '' AS file_path, 'text/markdown' AS mime_type, tw.conversation_id, tw.created_at, COALESCE(wm.updated_at, tw.created_at) AS updated_at, COALESCE(wm.favorite, 0) AS favorite, COALESCE(wm.tags, '') AS tags, COALESCE((SELECT group_concat(project_id) FROM work_projects WHERE work_type = 'text' AND work_id = tw.id), '') AS project_ids FROM text_works tw LEFT JOIN conversations c ON c.id = tw.conversation_id LEFT JOIN work_metadata wm ON wm.work_type = 'text' AND wm.work_id = tw.id
  UNION ALL
  SELECT 'image', iw.id, COALESCE(NULLIF(wm.title, ''), substr(iw.prompt, 1, 36)), '', iw.prompt, iw.provider, iw.model, iw.size, iw.quality, iw.file_path, iw.mime_type, NULL, iw.created_at, COALESCE(wm.updated_at, iw.created_at), COALESCE(wm.favorite, 0), COALESCE(wm.tags, ''), COALESCE((SELECT group_concat(project_id) FROM work_projects WHERE work_type = 'image' AND work_id = iw.id), '') FROM image_works iw LEFT JOIN work_metadata wm ON wm.work_type = 'image' AND wm.work_id = iw.id
  UNION ALL
  SELECT 'video', vw.id, COALESCE(NULLIF(wm.title, ''), vw.title), '', vw.prompt, vw.provider, vw.model, vw.ratio, vw.resolution || ' · ' || vw.duration || '秒', vw.file_path, vw.mime_type, NULL, vw.created_at, COALESCE(wm.updated_at, vw.created_at), COALESCE(wm.favorite, 0), COALESCE(wm.tags, ''), COALESCE((SELECT group_concat(project_id) FROM work_projects WHERE work_type = 'video' AND work_id = vw.id), '') FROM video_works vw LEFT JOIN work_metadata wm ON wm.work_type = 'video' AND wm.work_id = vw.id
  UNION ALL
  SELECT 'audio', aw.id, COALESCE(NULLIF(wm.title, ''), aw.title), '', aw.prompt, aw.provider, aw.model, aw.voice, CAST(aw.speed AS TEXT), aw.file_path, aw.mime_type, NULL, aw.created_at, COALESCE(wm.updated_at, aw.created_at), COALESCE(wm.favorite, 0), COALESCE(wm.tags, ''), COALESCE((SELECT group_concat(project_id) FROM work_projects WHERE work_type = 'audio' AND work_id = aw.id), '') FROM audio_works aw LEFT JOIN work_metadata wm ON wm.work_type = 'audio' AND wm.work_id = aw.id`

function mapUnifiedRows(rows: Omit<UnifiedWorkRow, 'key' | 'missing'>[]) {
  return rows.map((row) => ({ ...row, key: `${row.type}-${row.id}`, missing: 0 }))
}

export function listUnifiedWorks() {
  const rows = db().prepare(`SELECT * FROM (${unifiedWorksSql}) ORDER BY updated_at DESC`).all() as unknown as Omit<UnifiedWorkRow, 'key' | 'missing'>[]
  return mapUnifiedRows(rows)
}

export function listUnifiedWorksByKeys(keys: string[]) {
  if (!keys.length) return []
  const wanted = new Set(keys)
  return listUnifiedWorks().filter((work) => wanted.has(work.key))
}

export function listUnifiedWorksPage(input: WorksPageInput = {}): WorksPageResult {
  const page = Math.max(1, Number(input.page) || 1)
  const pageSize = Math.min(60, Math.max(12, Number(input.pageSize) || 20))
  const where: string[] = []; const values: Array<string | number> = []
  if (input.kind && input.kind !== 'all') { where.push('type = ?'); values.push(input.kind) }
  if (input.query?.trim()) { const search = `%${input.query.trim()}%`; where.push('(title LIKE ? OR prompt LIKE ? OR tags LIKE ?)'); values.push(search, search, search) }
  if (input.provider) { where.push('provider = ?'); values.push(input.provider) }
  if (input.model) { where.push('model = ?'); values.push(input.model) }
  if (input.projectId) { where.push("(',' || project_ids || ',') LIKE ?"); values.push(`%,${input.projectId},%`) }
  if (input.time) { const cutoff = new Date(); const days = input.time === 'today' ? 1 : input.time === 'week' ? 7 : input.time === 'month' ? 30 : 0; if (days) { cutoff.setDate(cutoff.getDate() - days); where.push('created_at >= ?'); values.push(cutoff.toISOString()) } }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const base = `FROM (${unifiedWorksSql}) works${clause}`
  const total = Number((db().prepare(`SELECT COUNT(*) AS count ${base}`).get(...values) as { count: number }).count)
  const rows = db().prepare(`SELECT * ${base} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as unknown as Omit<UnifiedWorkRow, 'key' | 'missing'>[]
  const allCounts = db().prepare(`SELECT type, COUNT(*) AS count FROM (${unifiedWorksSql}) GROUP BY type`).all() as unknown as Array<{ type: WorkType; count: number }>
  const counts: Record<'all' | WorkType, number> = { all: 0, text: 0, image: 0, video: 0, audio: 0 }
  allCounts.forEach((row) => { counts[row.type] = Number(row.count); counts.all += Number(row.count) })
  const providers = (db().prepare(`SELECT DISTINCT provider FROM (${unifiedWorksSql}) WHERE provider <> '' ORDER BY provider`).all() as Array<{ provider: string }>).map((row) => row.provider)
  const models = (db().prepare(`SELECT DISTINCT model FROM (${unifiedWorksSql}) WHERE model <> '' ORDER BY model`).all() as Array<{ model: string }>).map((row) => row.model)
  const latest = String((db().prepare(`SELECT COALESCE(MAX(updated_at), '') AS latest FROM (${unifiedWorksSql})`).get() as { latest: string }).latest)
  return { items: mapUnifiedRows(rows), total, page, pageSize, counts, providers, models, latest }
}

export function updateWorkMeta(type: WorkType, id: number, input: { title: string; favorite: boolean; tags: string }) {
  const now = new Date().toISOString()
  db().prepare(`INSERT INTO work_metadata (work_type, work_id, title, favorite, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(work_type, work_id) DO UPDATE SET title = excluded.title, favorite = excluded.favorite, tags = excluded.tags, updated_at = excluded.updated_at`).run(type, id, input.title, input.favorite ? 1 : 0, input.tags, now)
  if (type === 'text') db().prepare('UPDATE text_works SET title = ? WHERE id = ?').run(input.title, id)
}

export function deleteWork(type: WorkType, id: number) {
  const image = type === 'image' ? getImageWork(id) : undefined
  const audio = type === 'audio' ? getAudioWork(id) : undefined
  const video = type === 'video' ? getVideoWork(id) : undefined
  db().exec('BEGIN')
  try {
    db().prepare(`DELETE FROM ${type === 'text' ? 'text_works' : type === 'image' ? 'image_works' : type === 'video' ? 'video_works' : 'audio_works'} WHERE id = ?`).run(id)
    db().prepare('DELETE FROM work_metadata WHERE work_type = ? AND work_id = ?').run(type, id)
    db().prepare('DELETE FROM work_projects WHERE work_type = ? AND work_id = ?').run(type, id)
    db().prepare('DELETE FROM work_tasks WHERE work_type = ? AND work_id = ?').run(type, id)
    db().exec('COMMIT')
  } catch (error) { db().exec('ROLLBACK'); throw error }
  return image?.file_path ?? audio?.file_path ?? video?.file_path
}

export function addWorkToProject(type: WorkType, id: number, projectId: number) { db().prepare('INSERT OR IGNORE INTO work_projects (work_type, work_id, project_id, created_at) VALUES (?, ?, ?, ?)').run(type, id, projectId, new Date().toISOString()) }
export function linkWorkTask(type: WorkType, id: number, taskId: number) { db().prepare('INSERT OR IGNORE INTO work_tasks (work_type, work_id, task_id, created_at) VALUES (?, ?, ?, ?)').run(type, id, taskId, new Date().toISOString()) }

export function listPublishAccounts() { return db().prepare('SELECT * FROM publish_accounts ORDER BY enabled DESC, id ASC').all() as unknown as PublishAccountRow[] }
export function getPublishAccount(id: number) { return db().prepare('SELECT * FROM publish_accounts WHERE id = ?').get(id) as unknown as PublishAccountRow | undefined }
export function createPublishAccount(input: { platform: string; name: string; handle: string; simulation: boolean }) { const now = new Date().toISOString(); const result = db().prepare('INSERT INTO publish_accounts (platform, name, handle, enabled, simulation, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(input.platform, input.name, input.handle, input.simulation ? 1 : 0, now, now); return db().prepare('SELECT * FROM publish_accounts WHERE id = ?').get(result.lastInsertRowid) as unknown as PublishAccountRow }
export function updatePublishAccount(id: number, input: { platform: string; name: string; handle: string; enabled: boolean; simulation: boolean }) { db().prepare('UPDATE publish_accounts SET platform = ?, name = ?, handle = ?, enabled = ?, simulation = ?, updated_at = ? WHERE id = ?').run(input.platform, input.name, input.handle, input.enabled ? 1 : 0, input.simulation ? 1 : 0, new Date().toISOString(), id); return db().prepare('SELECT * FROM publish_accounts WHERE id = ?').get(id) as unknown as PublishAccountRow }
export function deletePublishAccount(id: number) { const used = db().prepare('SELECT COUNT(*) AS count FROM publications WHERE account_id = ?').get(id) as { count: number }; if (used.count) throw new Error('该账号已有发布记录，请停用账号而不是删除'); db().prepare('DELETE FROM publish_accounts WHERE id = ?').run(id) }

export function listPublications() { return db().prepare(`SELECT p.*, a.platform, a.name AS account_name, COALESCE(pr.name, '') AS project_name, COALESCE((SELECT group_concat(work_type || '-' || work_id) FROM publication_works WHERE publication_id = p.id ORDER BY sort_order), '') AS work_keys FROM publications p JOIN publish_accounts a ON a.id = p.account_id LEFT JOIN projects pr ON pr.id = p.project_id ORDER BY p.updated_at DESC, p.id DESC`).all() as unknown as PublicationRow[] }
export function getPublication(id: number) { return db().prepare(`SELECT p.*, a.platform, a.name AS account_name, COALESCE(pr.name, '') AS project_name, COALESCE((SELECT group_concat(work_type || '-' || work_id) FROM publication_works WHERE publication_id = p.id ORDER BY sort_order), '') AS work_keys FROM publications p JOIN publish_accounts a ON a.id = p.account_id LEFT JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?`).get(id) as unknown as PublicationRow | undefined }
export function createPublications(input: { accountIds: number[]; projectId?: number | null; title: string; body: string; topics: string; status: string; scheduledAt?: string | null; workKeys: string[] }) {
  const now = new Date().toISOString(); const created: PublicationRow[] = []
  db().exec('BEGIN')
  try {
    for (const accountId of input.accountIds) {
      const duplicate = db().prepare(`SELECT id FROM publications WHERE account_id = ? AND title = ? AND body = ? AND status NOT IN ('failed', 'cancelled') LIMIT 1`).get(accountId, input.title, input.body)
      if (duplicate) throw new Error('检测到同一账号已有相同内容，请修改后再保存')
      const result = db().prepare('INSERT INTO publications (account_id, project_id, title, body, topics, status, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(accountId, input.projectId ?? null, input.title, input.body, input.topics, input.status, input.scheduledAt ?? null, now, now)
      const publicationId = Number(result.lastInsertRowid); const link = db().prepare('INSERT INTO publication_works (publication_id, work_type, work_id, sort_order) VALUES (?, ?, ?, ?)')
      input.workKeys.forEach((key, index) => { const [type, id] = key.split('-'); if (['text', 'image', 'video', 'audio'].includes(type) && Number(id)) link.run(publicationId, type, Number(id), index) })
      db().prepare('INSERT INTO publication_logs (publication_id, status, message, created_at) VALUES (?, ?, ?, ?)').run(publicationId, input.status, input.status === 'scheduled' ? '已加入发布计划' : '草稿已保存', now)
      const row = getPublication(publicationId); if (row) created.push(row)
    }
    db().exec('COMMIT'); return created
  } catch (error) { db().exec('ROLLBACK'); throw error }
}
export function updatePublication(id: number, input: { accountId: number; projectId?: number | null; title: string; body: string; topics: string; status: string; scheduledAt?: string | null; workKeys: string[] }) {
  const now = new Date().toISOString(); db().exec('BEGIN')
  try { db().prepare('UPDATE publications SET account_id = ?, project_id = ?, title = ?, body = ?, topics = ?, status = ?, scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?').run(input.accountId, input.projectId ?? null, input.title, input.body, input.topics, input.status, input.scheduledAt ?? null, now, id); db().prepare('DELETE FROM publication_works WHERE publication_id = ?').run(id); const link = db().prepare('INSERT INTO publication_works (publication_id, work_type, work_id, sort_order) VALUES (?, ?, ?, ?)'); input.workKeys.forEach((key, index) => { const [type, workId] = key.split('-'); if (['text', 'image', 'video', 'audio'].includes(type) && Number(workId)) link.run(id, type, Number(workId), index) }); db().prepare('INSERT INTO publication_logs (publication_id, status, message, created_at) VALUES (?, ?, ?, ?)').run(id, input.status, '发布内容已更新', now); db().exec('COMMIT'); return getPublication(id) } catch (error) { db().exec('ROLLBACK'); throw error }
}
export function setPublicationStatus(id: number, status: string, message: string, values?: { resultUrl?: string | null; error?: string | null; publishedAt?: string | null }) { const now = new Date().toISOString(); db().prepare('UPDATE publications SET status = ?, result_url = COALESCE(?, result_url), error = ?, published_at = COALESCE(?, published_at), updated_at = ? WHERE id = ?').run(status, values?.resultUrl ?? null, values?.error ?? null, values?.publishedAt ?? null, now, id); db().prepare('INSERT INTO publication_logs (publication_id, status, message, created_at) VALUES (?, ?, ?, ?)').run(id, status, message, now); return getPublication(id) }
export function deletePublication(id: number) { db().prepare('DELETE FROM publications WHERE id = ?').run(id) }
export function listDuePublications(now = new Date().toISOString()) { return db().prepare("SELECT id FROM publications WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC").all(now) as unknown as Array<{ id: number }> }
