/**
 * Skills Sync - Bundled skills seeding and syncing
 * Adapted from Hermes skills_sync.py
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync, rmSync } from 'fs'
import { join, relative, dirname, sep } from 'path'
import { createHash } from 'crypto'
import { homedir } from 'os'

const MANIFEST_FILE = '.bundled_manifest'
const NO_BUNDLED_MARKER = '.no-bundled-skills'

/**
 * Get bundled skills source directory (Hermes reference)
 */
export function getBundledSkillsDir(): string {
  // Use Hermes reference repo as bundled source
  const refPath = '/home/vallenganteng/Destop/vallenatrix/refrensi hermes-agent-2026.9.24/skills'
  if (existsSync(refPath)) {
    return refPath
  }
  // Fallback to empty (no bundled skills)
  return ''
}

/**
 * Get user skills directory
 */
export function getUserSkillsDir(): string {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return join(vallenatrixHome, 'skills')
}

/**
 * Check if bundled skills seeding is opted out
 */
export function isOptedOut(): boolean {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return existsSync(join(vallenatrixHome, NO_BUNDLED_MARKER))
}

/**
 * Opt out of bundled skills seeding
 */
export function optOut(): void {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  const marker = join(vallenatrixHome, NO_BUNDLED_MARKER)
  if (!existsSync(vallenatrixHome)) {
    mkdirSync(vallenatrixHome, { recursive: true })
  }
  writeFileSync(marker, `# Opted out of bundled skills seeding\n# Created: ${new Date().toISOString()}\n`, 'utf-8')
}

/**
 * Opt in to bundled skills seeding
 */
export function optIn(): void {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  const marker = join(vallenatrixHome, NO_BUNDLED_MARKER)
  if (existsSync(marker)) {
    rmSync(marker)
  }
}

/**
 * Compute SHA256 hash of skill directory content
 */
export function computeSkillHash(skillDir: string): string {
  const hash = createHash('sha256')
  const files: string[] = []

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        const relPath = relative(skillDir, fullPath)
        files.push(relPath)
      }
    }
  }

  walk(skillDir)
  files.sort()

  for (const file of files) {
    const fullPath = join(skillDir, file)
    try {
      const content = readFileSync(fullPath, 'utf-8')
      hash.update(file)
      hash.update('\x00')
      hash.update(content)
      hash.update('\x00')
    } catch {
      // Skip unreadable files
    }
  }

  return hash.digest('hex')
}

/**
 * Read manifest file
 */
export function readManifest(): Record<string, string> {
  const skillsDir = getUserSkillsDir()
  const manifestPath = join(skillsDir, MANIFEST_FILE)
  
  if (!existsSync(manifestPath)) {
    return {}
  }

  try {
    const content = readFileSync(manifestPath, 'utf-8')
    const manifest: Record<string, string> = {}
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      
      const [name, hash] = trimmed.split(':').map(s => s.trim())
      if (name && hash) {
        manifest[name] = hash
      }
    }
    
    return manifest
  } catch {
    return {}
  }
}

/**
 * Write manifest file
 */
export function writeManifest(manifest: Record<string, string>): void {
  const skillsDir = getUserSkillsDir()
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }

  const manifestPath = join(skillsDir, MANIFEST_FILE)
  const lines = Object.entries(manifest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => `${name}:${hash}`)
  
  writeFileSync(manifestPath, lines.join('\n') + '\n', 'utf-8')
}

/**
 * Discover bundled skills
 */
export function discoverBundledSkills(): Array<{ name: string; path: string }> {
  const bundledDir = getBundledSkillsDir()
  if (!bundledDir || !existsSync(bundledDir)) {
    return []
  }

  const skills: Array<{ name: string; path: string }> = []

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory()) {
        // Check if contains SKILL.md
        const skillMd = join(fullPath, 'SKILL.md')
        if (existsSync(skillMd)) {
          // Extract name from directory or frontmatter
          const name = entry.name
          skills.push({ name, path: fullPath })
        } else {
          // Recurse into subdirectories
          walk(fullPath)
        }
      }
    }
  }

  walk(bundledDir)
  return skills
}

/**
 * Copy skill directory recursively
 */
function copySkillDir(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }

  const entries = readdirSync(src, { withFileTypes: true })
  
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    
    if (entry.isDirectory()) {
      copySkillDir(srcPath, destPath)
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Sync bundled skills
 */
export interface SyncResult {
  added: string[]
  updated: string[]
  skipped: string[]
  deleted: string[]
  errors: Array<{ skill: string; error: string }>
}

export function syncBundledSkills(options: { force?: boolean } = {}): SyncResult {
  const result: SyncResult = {
    added: [],
    updated: [],
    skipped: [],
    deleted: [],
    errors: []
  }

  // Check opt-out
  if (!options.force && isOptedOut()) {
    console.log('[SkillsSync] Opted out, skipping bundled skills sync')
    return result
  }

  const bundledSkills = discoverBundledSkills()
  if (bundledSkills.length === 0) {
    console.log('[SkillsSync] No bundled skills found')
    return result
  }

  const manifest = readManifest()
  const newManifest: Record<string, string> = { ...manifest }
  const skillsDir = getUserSkillsDir()

  for (const { name, path: srcPath } of bundledSkills) {
    try {
      const destPath = join(skillsDir, name)
      const srcHash = computeSkillHash(srcPath)
      const manifestHash = manifest[name]
      
      // NEW skill - copy
      if (!existsSync(destPath)) {
        copySkillDir(srcPath, destPath)
        newManifest[name] = srcHash
        result.added.push(name)
        console.log(`[SkillsSync] Added: ${name}`)
        continue
      }

      // EXISTING skill
      const destHash = computeSkillHash(destPath)
      
      // User modified (dest hash != manifest hash) - SKIP
      if (manifestHash && destHash !== manifestHash) {
        result.skipped.push(name)
        console.log(`[SkillsSync] Skipped (user modified): ${name}`)
        continue
      }

      // Upstream changed (src hash != manifest hash) - UPDATE
      if (srcHash !== manifestHash) {
        rmSync(destPath, { recursive: true, force: true })
        copySkillDir(srcPath, destPath)
        newManifest[name] = srcHash
        result.updated.push(name)
        console.log(`[SkillsSync] Updated: ${name}`)
        continue
      }

      // No change needed
      console.log(`[SkillsSync] Up to date: ${name}`)
    } catch (err: any) {
      result.errors.push({ skill: name, error: err.message })
      console.error(`[SkillsSync] Error syncing ${name}:`, err)
    }
  }

  // Write updated manifest
  writeManifest(newManifest)

  return result
}

/**
 * Reset a skill to bundled version
 */
export function resetSkill(name: string): { success: boolean; message: string } {
  const bundledSkills = discoverBundledSkills()
  const bundled = bundledSkills.find(s => s.name === name)
  
  if (!bundled) {
    return { success: false, message: `Skill '${name}' not found in bundled skills` }
  }

  try {
    const skillsDir = getUserSkillsDir()
    const destPath = join(skillsDir, name)
    
    // Remove existing
    if (existsSync(destPath)) {
      rmSync(destPath, { recursive: true, force: true })
    }
    
    // Copy bundled
    copySkillDir(bundled.path, destPath)
    
    // Update manifest
    const manifest = readManifest()
    manifest[name] = computeSkillHash(bundled.path)
    writeManifest(manifest)
    
    return { success: true, message: `Reset skill '${name}' to bundled version` }
  } catch (err: any) {
    return { success: false, message: `Failed to reset skill: ${err.message}` }
  }
}
