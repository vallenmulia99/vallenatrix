import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep, join } from 'node:path'

export type TypeScriptDiagnosticSnapshot = Map<string, string>
type TypeScriptService = { service: any; ts: any; versions: Map<string, number> }
const services = new Map<string, TypeScriptService>()
const MAX_SERVICES = 16

function loadTypeScript(): any | null {
  try { return require('typescript') } catch { return null }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function getService(filePath: string, workspaceDir: string): TypeScriptService | null {
  const root = resolve(workspaceDir)
  const file = resolve(filePath)
  if (!isInside(root, file) || !/\.tsx?$/.test(file)) return null
  let dir = dirname(file)
  let configPath = ''
  while (dir === root || dir.startsWith(`${root}${sep}`)) {
    const candidate = join(dir, 'tsconfig.json')
    if (existsSync(candidate)) { configPath = candidate; break }
    if (dir === root) break
    dir = dirname(dir)
  }
  if (!configPath) return null
  if (services.has(configPath)) return services.get(configPath)!

  try {
    const ts = loadTypeScript()
    if (!ts) return null
    if (services.size >= MAX_SERVICES) {
      const [oldestPath, oldest] = services.entries().next().value!
      oldest.service.dispose()
      services.delete(oldestPath)
    }
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (config.error) return null
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), { noEmit: true }, configPath)
    const versions = new Map<string, number>()
    const host = {
      getScriptFileNames: () => [...new Set([...parsed.fileNames, ...versions.keys()])],
      getScriptVersion: (path: string) => String(versions.get(resolve(path)) || 0),
      getScriptSnapshot: (path: string) => {
        try { return ts.ScriptSnapshot.fromString(readFileSync(path, 'utf8')) } catch { return undefined }
      },
      getCurrentDirectory: () => dirname(configPath),
      getCompilationSettings: () => ({ ...parsed.options, noEmit: true }),
      getDefaultLibFileName: (options: any) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine
    }
    const service = { service: ts.createLanguageService(host), ts, versions }
    services.set(configPath, service)
    return service
  } catch {
    return null
  }
}

export function captureTypeScriptDiagnostics(filePath: string, workspaceDir: string): TypeScriptDiagnosticSnapshot | null {
  try {
    const file = resolve(filePath)
    const entry = getService(file, workspaceDir)
    if (!entry) return null
    entry.versions.set(file, (entry.versions.get(file) || 0) + 1)
    const diagnostics = [
      ...entry.service.getSyntacticDiagnostics(file),
      ...entry.service.getSemanticDiagnostics(file)
    ]
    const snapshot: TypeScriptDiagnosticSnapshot = new Map()
    for (const diagnostic of diagnostics) {
      const message = entry.ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
      const position = diagnostic.start === undefined ? null : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      const key = `${diagnostic.code}:${diagnostic.start ?? ''}:${message}`
      const where = position ? `${position.line + 1}:${position.character + 1}` : 'project'
      snapshot.set(key, `${diagnostic.category === entry.ts.DiagnosticCategory.Error ? 'ERROR' : 'WARN'} [${where}] TS${diagnostic.code}: ${message}`)
    }
    return snapshot
  } catch {
    return null
  }
}

export function newTypeScriptDiagnostics(
  before: TypeScriptDiagnosticSnapshot | null,
  after: TypeScriptDiagnosticSnapshot | null,
  limit = 20
): string | undefined {
  if (!before || !after) return undefined
  const added = [...after].filter(([key]) => !before.has(key)).map(([, text]) => text)
  if (!added.length) return undefined
  const shown = added.slice(0, limit)
  return `TypeScript diagnostics introduced by this edit:\n${shown.join('\n')}${added.length > limit ? `\n... ${added.length - limit} more` : ''}`
}
