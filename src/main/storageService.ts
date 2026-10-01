import { app, type App } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

type StorageConfig = { root: string; previousRoot?: string; updatedAt: string }

function configPath(electronApp: App) { return join(electronApp.getPath('userData'), 'config', 'storage.json') }
export function getStorageConfig(electronApp: App = app): StorageConfig | null {
  const file = configPath(electronApp); if (!existsSync(file)) return null
  try { const value = JSON.parse(readFileSync(file, 'utf8')) as StorageConfig; return value.root ? value : null } catch { return null }
}
export function getStorageRoot(electronApp: App = app) { return getStorageConfig(electronApp)?.root || electronApp.getPath('userData') }
export function storageStatus(electronApp: App = app) { const config = getStorageConfig(electronApp); return { root: getStorageRoot(electronApp), customized: Boolean(config), defaultRoot: electronApp.getPath('userData') } }

export function migrateStorage(selectedDirectory: string, electronApp: App = app) {
  const currentRoot = resolve(getStorageRoot(electronApp)); const selected = resolve(selectedDirectory)
  const targetRoot = basename(selected).toLowerCase() === 'rainbowai-data' ? selected : join(selected, 'RainbowAI-Data')
  if (resolve(targetRoot).toLowerCase() === currentRoot.toLowerCase()) return storageStatus(electronApp)
  mkdirSync(targetRoot, { recursive: true })
  for (const folder of ['data', 'works', 'video-studio']) {
    const source = join(currentRoot, folder); if (existsSync(source)) cpSync(source, join(targetRoot, folder), { recursive: true, force: true })
  }
  const file = configPath(electronApp); mkdirSync(join(electronApp.getPath('userData'), 'config'), { recursive: true })
  writeFileSync(file, JSON.stringify({ root: targetRoot, previousRoot: currentRoot, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  return { root: targetRoot, customized: true, defaultRoot: electronApp.getPath('userData') }
}
