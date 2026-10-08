/**
 * Skills Hub Search - GitHub and registry search
 * Adapted from Hermes Agent skills_hub_search.py
 */

import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, resolve, sep } from 'path'
import { URL } from 'url'
import type { SkillSearchResult, SkillBundle } from './skills_hub_models'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export interface SearchOptions {
  query?: string
  source?: string
  limit?: number
}

/**
 * Search GitHub for skill repositories
 */
export async function searchGitHub(query: string, limit: number = 10): Promise<SkillSearchResult[]> {
  try {
    // Search GitHub repos with "skill" or "SKILL.md" in files
    const searchQuery = `${query} SKILL.md in:file language:markdown`
    const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${limit}`
    
    // Use curl to avoid adding axios dependency
    const { stdout } = await execAsync(`curl -s "${apiUrl}"`)
    const data = JSON.parse(stdout)
    
    if (!data.items) return []
    
    return data.items.map((repo: any) => ({
      identifier: repo.full_name,
      name: repo.name,
      description: repo.description || 'No description',
      source: 'github',
      trust_level: 'community',
      repo_url: repo.html_url,
      install_command: `/skills install ${repo.html_url}`
    }))
  } catch (err) {
    console.warn(`[SkillSearch] GitHub search failed:`, err)
    return []
  }
}

/**
 * Search official Hermes skills (from reference repo)
 */
export async function searchOfficialSkills(query: string, limit: number = 20): Promise<SkillSearchResult[]> {
  // Hardcoded list of common official skills
  const officialSkills = [
    { name: 'github', category: 'software-development', description: 'GitHub via gh CLI: PRs, issues, reviews, repos, auth' },
    { name: 'systematic-debugging', category: 'software-development', description: '4-phase root cause debugging: understand bugs before fixing' },
    { name: 'test-driven-development', category: 'software-development', description: 'TDD: enforce RED-GREEN-REFACTOR, tests before code' },
    { name: 'blocked-page-recovery', category: 'web', description: 'Use when a fetch fails: 403/429, paywall, WAF, bot wall' },
    { name: 'arxiv', category: 'research', description: 'Search arXiv papers by keyword, author, category, or ID' },
    { name: 'obsidian', category: 'note-taking', description: 'Read, search, create, and edit notes in the Obsidian vault' },
    { name: 'google-workspace', category: 'productivity', description: 'Gmail, Calendar, Drive, Docs, Sheets via gws CLI or Python' },
    { name: 'docker-compose', category: 'devops', description: 'Docker Compose orchestration: services, networks, volumes' },
    { name: 'kubernetes', category: 'devops', description: 'Kubernetes cluster management: pods, services, deployments' },
    { name: 'terraform', category: 'devops', description: 'Infrastructure as Code via Terraform CLI' }
  ]
  
  const lowerQuery = query.toLowerCase()
  const results = officialSkills
    .filter(skill => 
      skill.name.includes(lowerQuery) || 
      skill.category.includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit)
    .map(skill => ({
      identifier: `official/${skill.category}/${skill.name}`,
      name: skill.name,
      category: skill.category,
      description: skill.description,
      source: 'official',
      trust_level: 'builtin' as const,
      install_command: `/skills install official/${skill.category}/${skill.name}`
    }))
  
  return results
}

/**
 * Search all sources
 */
export async function searchSkills(options: SearchOptions): Promise<SkillSearchResult[]> {
  const { query = '', source, limit = 20 } = options
  
  const results: SkillSearchResult[] = []
  
  // Search official first
  if (!source || source === 'official') {
    const official = await searchOfficialSkills(query, Math.floor(limit / 2))
    results.push(...official)
  }
  
  // Search GitHub
  if (!source || source === 'github') {
    const github = await searchGitHub(query, Math.floor(limit / 2))
    results.push(...github)
  }
  
  // Deduplicate and sort by trust level
  const seen = new Set<string>()
  const trustRank = { builtin: 3, trusted: 2, community: 1, local: 0 }
  
  return results
    .filter(r => {
      if (seen.has(r.identifier)) return false
      seen.add(r.identifier)
      return true
    })
    .sort((a, b) => {
      const rankDiff = (trustRank[b.trust_level as keyof typeof trustRank] || 0) - 
                       (trustRank[a.trust_level as keyof typeof trustRank] || 0)
      if (rankDiff !== 0) return rankDiff
      return a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

/**
 * Fetch skill bundle from GitHub URL
 */
export async function fetchGitHubSkill(url: string): Promise<SkillBundle> {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com' || parsedUrl.username || parsedUrl.password || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(parsedUrl.pathname)) {
    throw new Error('Invalid GitHub skill URL')
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-'))
  
  try {
    // Clone repo (shallow, single branch)
    await execFileAsync('git', ['clone', '--depth', '1', '--', parsedUrl.toString(), tmpDir], { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    
    // Find SKILL.md files
    const skillFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== '.git') walk(path)
        else if (entry.isFile() && entry.name === 'SKILL.md') skillFiles.push(path)
      }
    }
    walk(tmpDir)
    
    if (skillFiles.length === 0) {
      throw new Error('No SKILL.md found in repository')
    }
    
    // Use first SKILL.md found
    const skillFile = skillFiles[0]
    const skillDir = skillFile.replace('/SKILL.md', '')
    
    // Read all files in skill directory
    const files: Record<string, string> = {}
    const filePaths: string[] = []
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) collect(path)
        else if (entry.isFile()) filePaths.push(path)
      }
    }
    collect(skillDir)
    
    for (const filePath of filePaths) {
      const relPath = relative(skillDir, filePath)
      try {
        const content = readFileSync(filePath, 'utf-8')
        files[relPath] = content
      } catch {
        // Skip binary files
      }
    }
    
    // Parse skill name from SKILL.md frontmatter
    const skillMdContent = files['SKILL.md'] || ''
    const nameMatch = skillMdContent.match(/^name:\s*(.+)$/m)
    const descMatch = skillMdContent.match(/^description:\s*(.+)$/m)
    
    const name = nameMatch ? nameMatch[1].trim() : url.split('/').pop() || 'unknown'
    const description = descMatch ? descMatch[1].trim() : 'No description'
    
    return {
      name,
      description,
      source: 'github',
      identifier: url,
      files,
      trust_level: 'community'
    }
  } finally {
    // Cleanup temp dir
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fetch official skill from Hermes reference
 */
export async function fetchOfficialSkill(category: string, name: string): Promise<SkillBundle> {
  if (!/^[A-Za-z0-9_-]+$/.test(category) || !/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid official skill identifier')
  const candidates = [process.env.VALLENATRIX_BUNDLED_SKILLS, join(__dirname, '../../.vallenatrix/skills'), join(process.cwd(), '.vallenatrix/skills')].filter(Boolean) as string[]
  const refPath = candidates.find(path => require('fs').existsSync(path))
  if (!refPath) throw new Error('Official skills directory not found')
  const skillPath = resolve(refPath, category, name)
  const relPath = relative(resolve(refPath), skillPath)
  if (!relPath || relPath === '..' || relPath.startsWith(`..${sep}`) || relPath.startsWith(`${sep}`)) throw new Error('Invalid official skill path')

  
  try {
    const { existsSync, readdirSync, readFileSync, statSync } = require('fs')
    const { join } = require('path')
    
    if (!existsSync(skillPath)) {
      throw new Error(`Official skill not found: ${category}/${name}`)
    }
    
    // Read all files recursively
    const files: Record<string, string> = {}
    
    function readDir(dir: string, baseDir: string) {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)
        
        if (stat.isDirectory()) {
          readDir(fullPath, baseDir)
        } else if (stat.isFile()) {
          const relPath = fullPath.replace(baseDir + '/', '')
          try {
            const content = readFileSync(fullPath, 'utf-8')
            files[relPath] = content
          } catch {
            // Skip binary files
          }
        }
      }
    }
    
    readDir(skillPath, skillPath)
    
    // Parse description from SKILL.md
    const skillMdContent = files['SKILL.md'] || ''
    const descMatch = skillMdContent.match(/^description:\s*(.+)$/m)
    const description = descMatch ? descMatch[1].trim() : 'Official Hermes skill'
    
    return {
      name,
      category,
      description,
      source: 'official',
      identifier: `official/${category}/${name}`,
      files,
      trust_level: 'builtin'
    }
  } catch (err) {
    throw new Error(`Failed to fetch official skill: ${err}`)
  }
}
