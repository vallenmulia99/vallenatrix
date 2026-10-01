import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, basename, relative, dirname } from 'path'
import matter from 'gray-matter'

export interface SkillMetadata {
  name: string
  description: string
  category?: string
  author?: string
  version?: string
  platforms?: string[]
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

const SKILL_PATTERN = /SKILL\.md$/i

function scanDirectory(dir: string, skills: Map<string, Skill>, rootDir: string = dir): void {
  if (!existsSync(dir)) {
    return
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Recursively scan subdirectories
        scanDirectory(fullPath, skills, rootDir)
      } else if (entry.isFile() && SKILL_PATTERN.test(entry.name)) {
        // Found a SKILL.md file
        try {
          const skillData = loadSkillFile(fullPath, rootDir)
          if (skillData) {
            if (skills.has(skillData.name)) {
              console.warn(`[Skills] Duplicate skill name '${skillData.name}': ${fullPath} overwrites ${skills.get(skillData.name)?.path}`)
            }
            skills.set(skillData.name, skillData)
          }
        } catch (err) {
          console.error(`[Skills] Failed to load ${fullPath}:`, err)
        }
      }
    }
  } catch (err) {
    console.error(`[Skills] Failed to scan directory ${dir}:`, err)
  }
}

function getLinkedFiles(skillDir: string): { references: string[]; templates: string[]; scripts: string[] } {
  const result = { references: [] as string[], templates: [] as string[], scripts: [] as string[] }
  for (const sub of ['references', 'templates', 'scripts'] as const) {
    const subDir = join(skillDir, sub)
    if (existsSync(subDir)) {
      try {
        const files = readdirSync(subDir)
        result[sub] = files.filter((f: string) => !f.startsWith('.'))
      } catch {
        // ignore read error
      }
    }
  }
  return result
}

function loadSkillFile(filePath: string, rootDir: string): Skill | null {
  const raw = readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  
  // Extract skill name from frontmatter or directory name
  const skillName = data.name || basename(dirname(filePath))
  
  if (!skillName) {
    console.warn(`[Skills] No name found for ${filePath}`)
    return null
  }

  // Determine category from frontmatter or relative path
  let category = data.category
  if (!category) {
    const rel = relative(rootDir, dirname(filePath))
    const parts = rel.split(require('path').sep).filter(Boolean)
    if (parts.length > 1) {
      category = parts[0]
    } else {
      category = 'general'
    }
  }

  const metadata: SkillMetadata = {
    name: skillName,
    description: data.description || 'No description',
    category,
    author: data.author,
    version: data.version,
    platforms: data.platforms
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

  constructor(private skillPaths: string[]) {}

  load(): void {
    this.skills.clear()
    
    for (const path of this.skillPaths) {
      scanDirectory(path, this.skills, path)
    }
    
    console.log(`[Skills] Loaded ${this.skills.size} skills`)
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
}
