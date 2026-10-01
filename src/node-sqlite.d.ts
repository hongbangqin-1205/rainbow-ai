declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): { run: (...params: unknown[]) => { lastInsertRowid: number | bigint }; get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] }
  }
}
