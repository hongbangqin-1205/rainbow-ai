export type AsrEngine = 'local' | 'api'

const engineKey = 'rainbow-asr-engine'
const apiDefaultMigrationKey = 'rainbow-asr-api-default-v1'

export function readAsrEngine(): AsrEngine {
  if (localStorage.getItem(apiDefaultMigrationKey) !== 'done') {
    localStorage.setItem(engineKey, 'api')
    localStorage.setItem(apiDefaultMigrationKey, 'done')
    return 'api'
  }
  return localStorage.getItem(engineKey) === 'local' ? 'local' : 'api'
}

export function saveAsrEngine(value: AsrEngine) {
  localStorage.setItem(engineKey, value)
  localStorage.setItem(apiDefaultMigrationKey, 'done')
}
