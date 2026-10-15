import { logger } from './logger'
import { readdirSync, readFileSync, existsSync, lstatSync } from 'fs'
import { join, basename, relative, dirname, sep } from 'path'
import { parse as parseYaml } from 'yaml'

export interface SkillMetadata {
  name: string
  description: string
  category?: string
  author?: string
  version?: string
  platforms?: string[]
  triggers?: string[]
  tags?: string[]
  [key: string]: any
}

export interface Skill {
  name: string
  path: string
  metadata: SkillMetadata
  content: string
  linkedFiles?: {
    references: string[]
    templates: string[]
    scripts: string[]
  }
}

const SKILL_PATTERN = /^SKILL\.md$/i

function scanDirectory(dir: string, skills: Map<string, Skill>, rootDir: string = dir, duplicates: string[] = []): void {
  if (!existsSync(dir)) {
    return
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Recursively scan subdirectories
        scanDirectory(fullPath, skills, rootDir, duplicates)
      } else if (entry.isFile() && SKILL_PATTERN.test(entry.name)) {
        // Found a SKILL.md file
        try {
          const skillData = loadSkillFile(fullPath, rootDir)
          if (skillData) {
            if (skills.has(skillData.name)) {
              duplicates.push(skillData.name)
              continue
            }
            skills.set(skillData.name, skillData)
          }
        } catch (err) {
          logger.error(`[Skills] Failed to load ${fullPath}:`, err)
        }
      }
    }
  } catch (err) {
    logger.error(`[Skills] Failed to scan directory ${dir}:`, err)
  }
}

function getLinkedFiles(skillDir: string): { references: string[]; templates: string[]; scripts: string[] } {
  const result = { references: [] as string[], templates: [] as string[], scripts: [] as string[] }
  for (const sub of ['references', 'templates', 'scripts'] as const) {
    const subDir = join(skillDir, sub)
    const collect = (dir: string): void => {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith('.')) continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) collect(fullPath)
          else if (entry.isFile()) result[sub].push(relative(subDir, fullPath).split(sep).join('/'))
        }
      } catch {
        // A missing or unreadable linked-file directory adds no entries.
      }
    }
    if (existsSync(subDir) && lstatSync(subDir).isDirectory()) collect(subDir)
  }
  return result
}

function parseFrontmatter(raw: string): { data: Record<string, any>; content: string } {
  const normalized = raw.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)
  if (!match) return { data: {}, content: normalized }

  const parsed = parseYaml(match[1], { maxAliasCount: 100 })
  if (parsed == null) return { data: {}, content: normalized.slice(match[0].length) }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Skill frontmatter must be a YAML mapping')
  }
  return { data: parsed as Record<string, unknown>, content: normalized.slice(match[0].length) }
}

function loadSkillFile(filePath: string, rootDir: string): Skill | null {
  const raw = readFileSync(filePath, 'utf-8')
  const { data, content } = parseFrontmatter(raw)
  
  // Extract skill name from frontmatter or directory name
  const skillName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : basename(dirname(filePath))
  
  if (!skillName) {
    logger.warn(`[Skills] No name found for ${filePath}`)
    return null
  }

  // Determine category from frontmatter or relative path
  let category = data.category
  if (!category) {
    const rel = relative(rootDir, dirname(filePath))
    const parts = rel.split(sep).filter(Boolean)
    if (parts.length > 1) {
      category = parts[0]
    } else {
      category = 'general'
    }
  }

  const nested = data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
  const hermes = nested.hermes && typeof nested.hermes === 'object' ? nested.hermes : {}
  const vallenatrix = nested.vallenatrix && typeof nested.vallenatrix === 'object' ? nested.vallenatrix : {}
  const collectStrings = (key: string): string[] => Array.from(new Set(
    [data[key], hermes[key], vallenatrix[key]]
      .flatMap(value => Array.isArray(value) ? value : [])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim())
  ))

  const metadata: SkillMetadata = {
    name: skillName,
    description: typeof data.description === 'string' ? data.description : 'No description',
    category: typeof category === 'string' ? category : 'general',
    author: data.author,
    version: data.version,
    platforms: data.platforms,
    triggers: collectStrings('triggers'),
    tags: collectStrings('tags')
  }

  const linkedFiles = getLinkedFiles(dirname(filePath))

  return {
    name: skillName,
    path: filePath,
    metadata,
    content: content.trim(),
    linkedFiles
  }
}

export class SkillLoader {
  private skills: Map<string, Skill> = new Map()
  private disabledSkills: Set<string> = new Set()
  private enabledSkills: Set<string> = new Set()

  constructor(private skillPaths: string[], config?: { disabled?: string[]; enabled?: string[] }) {
    if (config?.disabled) {
      this.disabledSkills = new Set(config.disabled)
    }
    if (config?.enabled) {
      this.enabledSkills = new Set(config.enabled)
    }
  }

  load(): void {
    this.skills.clear()
    const duplicates: string[] = []

    for (const path of this.skillPaths) {
      scanDirectory(path, this.skills, path, duplicates)
    }
    if (duplicates.length > 0) {
      logger.warn(`[Skills] Ignored ${duplicates.length} duplicate entries across ${new Set(duplicates).size} skill names`)
    }
    
    // Filter disabled skills
    if (this.disabledSkills.size > 0) {
      for (const name of this.disabledSkills) {
        this.skills.delete(name)
      }
    }
    
    // If enabled list exists, only keep those
    if (this.enabledSkills.size > 0) {
      const toKeep = new Set<string>()
      for (const name of this.enabledSkills) {
        if (this.skills.has(name)) {
          toKeep.add(name)
        }
      }
      this.skills = new Map(Array.from(this.skills.entries()).filter(([name]) => toKeep.has(name)))
    }
    
    logger.info(`[Skills] Loaded ${this.skills.size} skills (${this.disabledSkills.size} disabled)`)
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  listByCategory(category: string): Skill[] {
    return this.list().filter(s => s.metadata.category === category)
  }

  search(query: string): Skill[] {
    const lower = query.toLowerCase()
    return this.list().filter(s => 
      s.metadata.name.toLowerCase().includes(lower) ||
      s.metadata.description.toLowerCase().includes(lower)
    )
  }

  getRelevantSkills(query: string): Skill[] {
    if (!query) return []
    const messageLower = query.toLowerCase()
    const words = messageLower.match(/[a-z0-9_+-]{3,}/g) || []
    const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'buat', 'bikin', 'bikinin', 'tolong', 'please', 'page', 'app', 'hi', 'hello', 'this', 'that', 'with'])
    const filteredWords = words.slice(0, 128).filter(w => w.length <= 64 && !ignored.has(w))
    const normalizedMessage = ` ${messageLower.replace(/[^a-z0-9]+/g, ' ').trim()} `
    const matchesPhrase = (value: string): boolean => {
      const phrase = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      return Boolean(phrase && normalizedMessage.includes(` ${phrase} `))
    }

    const scored = this.list().map(skill => {
      let score = 0

      // Explicit skill triggers should outweigh generic tag overlap.
      const triggers = skill.metadata.triggers || []
      if (triggers.some(tr => typeof tr === 'string' && matchesPhrase(tr))) score += 100

      const tags = skill.metadata.tags || []
      for (const tag of tags) if (typeof tag === 'string' && matchesPhrase(tag)) score += 20

      // 3. Word matches in name & description (need >= 2 words or score >= 4)
      const descLower = `${skill.name} ${skill.metadata.description || ''}`.toLowerCase()
      let wordMatches = 0
      for (const w of filteredWords) {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(descLower)) wordMatches++
      }
      score += wordMatches * 2

      return { skill, score, wordMatches }
    })

    return scored
      .filter(item => item.score >= 20 || (item.wordMatches >= 2 && item.score >= 4))
      .sort((a, b) => b.score - a.score)
      .map(item => item.skill)
  }

  getFormattedIndex(): string {
    const byCategory = new Map<string, Skill[]>()
    for (const skill of this.skills.values()) {
      const cat = skill.metadata.category || 'general'
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(skill)
    }

    const lines: string[] = []
    const sortedCats = Array.from(byCategory.keys()).sort()
    for (const cat of sortedCats) {
      lines.push(`  ${cat}:`)
      const catSkills = byCategory.get(cat)!.sort((a, b) => a.name.localeCompare(b.name))
      for (const s of catSkills) {
        lines.push(`    - ${s.name}: ${s.metadata.description}`)
      }
    }

    return [
      "## Skills",
      "Before replying, scan the skills below. If a skill matches or is even partially relevant to your task, you MUST load it with skill_view(name) and follow its instructions. Err on the side of loading — it is always better to have context you don't need than to miss critical steps, pitfalls, or established workflows. Skills contain specialized knowledge — API endpoints, tool-specific commands, and proven workflows that outperform general-purpose approaches. Load the skill even if you think you could handle the task with basic tools like terminal.",
      "",
      "<available_skills>",
      lines.join('\n'),
      "</available_skills>",
      "",
      "Only proceed without loading a skill if genuinely none are relevant to the task."
    ].join('\n')
  }

  reload(): void {
    this.load()
  }

  scanAll(): void {
    this.load()
  }

  disable(name: string): boolean {
    if (this.disabledSkills.has(name) || !this.skills.has(name)) return false
    this.disabledSkills.add(name)
    this.skills.delete(name)
    return true
  }

  enable(name: string): boolean {
    if (!this.disabledSkills.has(name)) return false
    this.disabledSkills.delete(name)
    // Rescan to add it back
    this.load()
    return true
  }

  getDisabled(): string[] {
    return Array.from(this.disabledSkills)
  }

  getEnabled(): string[] {
    return Array.from(this.enabledSkills)
  }
}
