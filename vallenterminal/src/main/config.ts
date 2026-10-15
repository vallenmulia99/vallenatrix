import { app } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { AppConfig, Theme, DEFAULT_CONFIG, sanitizeConfig, validateTheme, isValidThemeName } from '../shared/types'

function isWithin(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export class ConfigManager {
  private configPath: string
  private userThemesDir: string
  private builtInThemesDir: string

  constructor() {
    const userData = app.getPath('userData')
    this.configPath = join(userData, 'config.json')
    this.userThemesDir = join(userData, 'themes')

    if (!existsSync(this.userThemesDir)) {
      try {
        mkdirSync(this.userThemesDir, { recursive: true })
      } catch {
        // Ignore directory creation failure
      }
    }

    // Determine built-in themes directory
    const candidates = [
      join(app.getAppPath(), 'themes'),
      join(app.getAppPath(), 'vallenterminal', 'themes'),
      join(__dirname, '../../themes'),
      join(__dirname, '../../../themes'),
      ...(!app.isPackaged ? [join(process.cwd(), 'themes'), join(process.cwd(), 'vallenterminal', 'themes')] : [])
    ]

    this.builtInThemesDir = candidates.find((dir) => existsSync(dir)) || candidates[0]
  }

  loadConfig(): AppConfig {
    if (!existsSync(this.configPath)) {
      return sanitizeConfig(DEFAULT_CONFIG)
    }
    try {
      const content = readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(content)
      return sanitizeConfig(parsed)
    } catch (error) {
      try {
        const backupPath = `${this.configPath}.corrupt-${Date.now()}`
        renameSync(this.configPath, backupPath)
        console.warn(`Corrupt config moved to ${backupPath}: ${error instanceof Error ? error.message : String(error)}`)
      } catch (renameError) {
        console.error(`Failed to preserve corrupt config ${this.configPath}: ${renameError instanceof Error ? renameError.message : String(renameError)}`)
      }
      return sanitizeConfig(DEFAULT_CONFIG)
    }
  }

  private writeAtomic(path: string, content: string): void {
    const tempPath = `${path}.tmp-${process.pid}`
    try {
      writeFileSync(tempPath, content, 'utf-8')
      renameSync(tempPath, path)
    } catch (error) {
      try { require('fs').unlinkSync(tempPath) } catch {}
      throw error
    }
  }

  saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    const current = this.loadConfig()
    // Security: do not allow renderer to modify shell binary via IPC
    const safePartial = { ...newConfig }
    delete (safePartial as any).shell

    const merged = sanitizeConfig({ ...current, ...safePartial, shell: current.shell })
    try {
      this.writeAtomic(this.configPath, JSON.stringify(merged, null, 2))
    } catch (error) {
      throw new Error(`Failed to save config: ${error instanceof Error ? error.message : String(error)}`)
    }
    return merged
  }

  listThemes(): Array<{ name: string; displayName: string; isBuiltIn: boolean }> {
    const results: Array<{ name: string; displayName: string; isBuiltIn: boolean }> = []
    const seen = new Set<string>()

    // Check built-in themes
    if (existsSync(this.builtInThemesDir)) {
      try {
        const files = readdirSync(this.builtInThemesDir)
        for (const file of files) {
          if (file.endsWith('.json')) {
            const theme = this.readThemeFile(join(this.builtInThemesDir, file))
            if (theme && !seen.has(theme.name)) {
              seen.add(theme.name)
              results.push({
                name: theme.name,
                displayName: theme.displayName || theme.name,
                isBuiltIn: true
              })
            }
          }
        }
      } catch {
        // Built-in read error
      }
    }

    // Check user themes
    if (existsSync(this.userThemesDir)) {
      try {
        const files = readdirSync(this.userThemesDir)
        for (const file of files) {
          if (file.endsWith('.json')) {
            const theme = this.readThemeFile(join(this.userThemesDir, file))
            if (theme && !seen.has(theme.name)) {
              seen.add(theme.name)
              results.push({
                name: theme.name,
                displayName: theme.displayName || theme.name,
                isBuiltIn: false
              })
            }
          }
        }
      } catch {
        // User theme read error
      }
    }

    return results
  }

  getTheme(name: string): Theme | null {
    if (!isValidThemeName(name)) return null

    // 1. Try user themes first
    const userDirResolved = resolve(this.userThemesDir)
    const userFile = resolve(this.userThemesDir, `${name}.json`)
    if (isWithin(userDirResolved, userFile) && existsSync(userFile)) {
      const theme = this.readThemeFile(userFile)
      if (theme) return theme
    }

    // 2. Try built-in themes
    const builtInDirResolved = resolve(this.builtInThemesDir)
    const builtInFile = resolve(this.builtInThemesDir, `${name}.json`)
    if (isWithin(builtInDirResolved, builtInFile) && existsSync(builtInFile)) {
      const theme = this.readThemeFile(builtInFile)
      if (theme) return theme
    }

    return null
  }

  saveUserTheme(theme: unknown): boolean {
    const validated = validateTheme(theme)
    if (!validated) return false

    const userDirResolved = resolve(this.userThemesDir)
    const dest = resolve(this.userThemesDir, `${validated.name}.json`)
    if (!isWithin(userDirResolved, dest)) {
      return false
    }

    try {
      this.writeAtomic(dest, JSON.stringify(validated, null, 2))
      return true
    } catch {
      return false
    }
  }

  private readThemeFile(path: string): Theme | null {
    try {
      const raw = readFileSync(path, 'utf-8')
      return validateTheme(JSON.parse(raw))
    } catch {
      return null
    }
  }
}
