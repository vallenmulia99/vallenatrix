import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { AppConfig, Theme, DEFAULT_CONFIG, sanitizeConfig, validateTheme, isValidThemeName } from '../shared/types'

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
      join(process.cwd(), 'themes'),
      join(process.cwd(), 'vallenterminal', 'themes')
    ]

    this.builtInThemesDir = candidates.find((dir) => existsSync(dir)) || join(process.cwd(), 'themes')
  }

  loadConfig(): AppConfig {
    if (!existsSync(this.configPath)) {
      return sanitizeConfig(DEFAULT_CONFIG)
    }
    try {
      const content = readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(content)
      return sanitizeConfig(parsed)
    } catch {
      return sanitizeConfig(DEFAULT_CONFIG)
    }
  }

  saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    const current = this.loadConfig()
    // Security: do not allow renderer to modify shell binary via IPC
    const safePartial = { ...newConfig }
    delete (safePartial as any).shell

    const merged = sanitizeConfig({ ...current, ...safePartial, shell: current.shell })
    try {
      writeFileSync(this.configPath, JSON.stringify(merged, null, 2), 'utf-8')
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
    if (userFile.startsWith(userDirResolved) && existsSync(userFile)) {
      const theme = this.readThemeFile(userFile)
      if (theme) return theme
    }

    // 2. Try built-in themes
    const builtInDirResolved = resolve(this.builtInThemesDir)
    const builtInFile = resolve(this.builtInThemesDir, `${name}.json`)
    if (builtInFile.startsWith(builtInDirResolved) && existsSync(builtInFile)) {
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
    if (!dest.startsWith(userDirResolved)) {
      return false
    }

    try {
      writeFileSync(dest, JSON.stringify(validated, null, 2), 'utf-8')
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
