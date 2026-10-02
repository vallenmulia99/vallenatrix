/**
 * Skills Hub Install - Install/uninstall/update operations with safety checks
 * Adapted from Hermes Agent skills_hub_install.py
 */

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync, lstatSync } from 'fs'
import { join, resolve, sep } from 'path'
import type { SkillBundle, LockEntry } from './skills_hub_models'
import {
  validateSkillName,
  validateCategory,
  validateBundleRelPath,
  getSkillsDir,
  getQuarantineDir,
  computeContentHash,
  isPathRedirect
} from './skills_hub_models'
import { HubLock, appendAuditLog } from './skills_hub_lock'

export interface InstallOptions {
  name?: string
  category?: string
  overwrite?: boolean
  skipScan?: boolean
}

export interface InstallResult {
  success: boolean
  name: string
  path: string
  message: string
  error?: string
}

/**
 * Quarantine bundle - Write to quarantine dir for scanning
 */
export function quarantineBundle(bundle: SkillBundle): string {
  const quarantineDir = getQuarantineDir()
  if (!existsSync(quarantineDir)) {
    mkdirSync(quarantineDir, { recursive: true })
  }

  const skillName = validateSkillName(bundle.name)
  const dest = join(quarantineDir, skillName)

  // Remove existing quarantine
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }

  mkdirSync(dest, { recursive: true })

  // Validate and write all files
  for (const [relPath, content] of Object.entries(bundle.files)) {
    const validPath = validateBundleRelPath(relPath)
    const fileDest = join(dest, ...validPath.split('/'))
    const fileDir = fileDest.substring(0, fileDest.lastIndexOf(sep))

    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true })
    }

    writeFileSync(fileDest, content, 'utf-8')
  }

  return dest
}

/**
 * Check if path is inside skills directory (no escapes, no symlink redirects)
 */
function resolveInstallPath(installPath: string): string {
  const skillsDir = resolve(getSkillsDir())
  const target = resolve(installPath)

  // Check each component for symlink redirects
  let current = skillsDir
  const parts = target.substring(skillsDir.length + 1).split(sep).filter(Boolean)

  for (const part of parts) {
    current = join(current, part)
    if (existsSync(current) && isPathRedirect(current)) {
      throw new Error(`Unsafe install path: contains symlink/junction at ${part}`)
    }
  }

  // Must be inside skills dir
  if (target === skillsDir || !target.startsWith(skillsDir + sep)) {
    throw new Error(`Unsafe install path: escapes skills directory`)
  }

  return target
}

/**
 * Get category skill directories (dirs containing SKILL.md)
 */
function getCategorySkillDirs(directory: string): string[] {
  if (!existsSync(directory)) return []

  const skillDirs: string[] = []
  const entries = readdirSync(directory)

  for (const entry of entries) {
    const fullPath = join(directory, entry)
    if (entry.startsWith('.')) continue

    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        // Check if contains SKILL.md anywhere below
        if (hasSkillMd(fullPath)) {
          skillDirs.push(entry)
        }
      }
    } catch {
      // Skip unreadable entries
    }
  }

  return skillDirs
}

/**
 * Check if directory contains SKILL.md (recursive)
 */
function hasSkillMd(dir: string): boolean {
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry === 'SKILL.md') return true

      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          if (hasSkillMd(fullPath)) return true
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return false
}

/**
 * Check install target safety
 */
function checkInstallTarget(installDir: string): void {
  const skillsDir = resolve(getSkillsDir())

  // Check not nested inside existing skill
  let ancestor = resolve(installDir, '..')
  while (ancestor !== skillsDir && ancestor.startsWith(skillsDir)) {
    if (existsSync(join(ancestor, 'SKILL.md'))) {
      throw new Error(
        `Refusing to install into '${ancestor}': it is an existing skill directory. Choose a different category.`
      )
    }
    ancestor = resolve(ancestor, '..')
  }

  if (!existsSync(installDir)) return

  // Must be directory
  const stat = lstatSync(installDir)
  if (!stat.isDirectory()) {
    throw new Error(
      `Refusing to install: '${installDir}' already exists and is not a directory. Remove it or choose a different name.`
    )
  }

  // If no SKILL.md, check if it's a category bucket with other skills
  if (!existsSync(join(installDir, 'SKILL.md'))) {
    const skillDirs = getCategorySkillDirs(installDir)
    if (skillDirs.length > 0) {
      throw new Error(
        `Refusing to overwrite category directory '${installDir}' which contains ${skillDirs.length} skill(s): ${skillDirs.join(', ')}. Use a different name or install into a subcategory.`
      )
    }
  }
}

/**
 * Basic content scan (check for dangerous patterns)
 */
function scanBundle(quarantinePath: string): { safe: boolean; issues: string[] } {
  const issues: string[] = []

  try {
    const files = getAllFiles(quarantinePath)

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')

      // Check for obvious malicious patterns
      if (content.includes('rm -rf /') || content.includes('rm -rf ~')) {
        issues.push(`Dangerous command in ${file}: rm -rf`)
      }

      if (content.match(/eval\s*\(/)) {
        issues.push(`Potentially dangerous: eval() in ${file}`)
      }

      if (content.match(/exec\s*\(/)) {
        issues.push(`Potentially dangerous: exec() in ${file}`)
      }

      // Check file size
      if (content.length > 10_000_000) {
        issues.push(`Suspicious file size in ${file}: ${Math.floor(content.length / 1024 / 1024)}MB`)
      }
    }
  } catch (err) {
    issues.push(`Scan error: ${err}`)
  }

  return {
    safe: issues.length === 0,
    issues
  }
}

/**
 * Get all files recursively
 */
function getAllFiles(dir: string): string[] {
  const files: string[] = []

  function walk(d: string) {
    const entries = readdirSync(d)
    for (const entry of entries) {
      const fullPath = join(d, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile()) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files
}

/**
 * Install skill from quarantine
 */
export function installFromQuarantine(
  quarantinePath: string,
  bundle: SkillBundle,
  options: InstallOptions = {}
): InstallResult {
  const lock = new HubLock()

  try {
    // Validate name
    const skillName = options.name ? validateSkillName(options.name) : validateSkillName(bundle.name)

    // Check if already installed
    if (lock.has(skillName) && !options.overwrite) {
      return {
        success: false,
        name: skillName,
        path: '',
        message: `Skill '${skillName}' already installed. Use --overwrite to replace.`,
        error: 'already_installed'
      }
    }

    // Scan bundle
    if (!options.skipScan) {
      const scanResult = scanBundle(quarantinePath)
      if (!scanResult.safe) {
        return {
          success: false,
          name: skillName,
          path: '',
          message: `Security scan failed:\n${scanResult.issues.join('\n')}`,
          error: 'scan_failed'
        }
      }
    }

    // Determine install path
    const skillsDir = getSkillsDir()
    const category = options.category ? validateCategory(options.category) : (bundle.category || '')
    const installDir = category ? join(skillsDir, category, skillName) : join(skillsDir, skillName)

    // Validate install target
    const resolvedInstallDir = resolveInstallPath(installDir)
    checkInstallTarget(resolvedInstallDir)

    // Remove existing if overwrite
    if (existsSync(resolvedInstallDir)) {
      rmSync(resolvedInstallDir, { recursive: true, force: true })
    }

    // Create install directory
    mkdirSync(resolvedInstallDir, { recursive: true })

    // Copy files from quarantine
    const installedFiles: string[] = []
    const files = getAllFiles(quarantinePath)

    for (const file of files) {
      const relPath = file.substring(quarantinePath.length + 1)
      const destFile = join(resolvedInstallDir, relPath)
      const destDir = destFile.substring(0, destFile.lastIndexOf(sep))

      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }

      const content = readFileSync(file, 'utf-8')
      writeFileSync(destFile, content, 'utf-8')
      installedFiles.push(relPath)
    }

    // Compute content hash
    const contentHash = computeContentHash(bundle.files)

    // Create lock entry
    const lockEntry: LockEntry = {
      name: skillName,
      source: bundle.source,
      identifier: bundle.identifier,
      install_path: category ? `${category}/${skillName}` : skillName,
      installed_at: new Date().toISOString(),
      content_hash: contentHash,
      files: installedFiles,
      metadata: bundle.metadata
    }

    // Save to lock file
    lock.set(skillName, lockEntry)

    // Audit log
    appendAuditLog('install', {
      skill: skillName,
      source: bundle.source,
      identifier: bundle.identifier,
      path: resolvedInstallDir
    })

    return {
      success: true,
      name: skillName,
      path: resolvedInstallDir,
      message: `✓ Installed skill '${skillName}' to ${category || 'root'}`
    }
  } catch (err: any) {
    return {
      success: false,
      name: bundle.name,
      path: '',
      message: `Installation failed: ${err.message}`,
      error: err.message
    }
  }
}

/**
 * Uninstall skill
 */
export function uninstallSkill(name: string): InstallResult {
  const lock = new HubLock()

  try {
    const skillName = validateSkillName(name)

    // Check if installed
    const entry = lock.get(skillName)
    if (!entry) {
      return {
        success: false,
        name: skillName,
        path: '',
        message: `Skill '${skillName}' is not installed`,
        error: 'not_found'
      }
    }

    // Resolve install path
    const skillsDir = getSkillsDir()
    const installPath = join(skillsDir, entry.install_path)

    // Remove directory
    if (existsSync(installPath)) {
      rmSync(installPath, { recursive: true, force: true })
    }

    // Remove from lock
    lock.delete(skillName)

    // Audit log
    appendAuditLog('uninstall', {
      skill: skillName,
      path: installPath
    })

    return {
      success: true,
      name: skillName,
      path: installPath,
      message: `✓ Uninstalled skill '${skillName}'`
    }
  } catch (err: any) {
    return {
      success: false,
      name,
      path: '',
      message: `Uninstall failed: ${err.message}`,
      error: err.message
    }
  }
}

/**
 * Update skill (re-install with same source)
 */
export async function updateSkill(name: string): Promise<InstallResult> {
  const lock = new HubLock()

  try {
    const skillName = validateSkillName(name)

    // Check if installed
    const entry = lock.get(skillName)
    if (!entry) {
      return {
        success: false,
        name: skillName,
        path: '',
        message: `Skill '${skillName}' is not installed`,
        error: 'not_found'
      }
    }

    // Re-fetch from source
    const { fetchGitHubSkill, fetchOfficialSkill } = require('./skills_hub_search')

    let bundle: SkillBundle

    if (entry.source === 'github') {
      bundle = await fetchGitHubSkill(entry.identifier)
    } else if (entry.source === 'official') {
      const parts = entry.identifier.split('/')
      if (parts.length !== 3) {
        throw new Error(`Invalid official identifier: ${entry.identifier}`)
      }
      bundle = await fetchOfficialSkill(parts[1], parts[2])
    } else {
      return {
        success: false,
        name: skillName,
        path: '',
        message: `Cannot update skill from source '${entry.source}'`,
        error: 'unsupported_source'
      }
    }

    // Check if content changed
    const newHash = computeContentHash(bundle.files)
    if (newHash === entry.content_hash) {
      return {
        success: true,
        name: skillName,
        path: join(getSkillsDir(), entry.install_path),
        message: `✓ Skill '${skillName}' is already up to date`
      }
    }

    // Quarantine and install
    const quarantinePath = quarantineBundle(bundle)
    const result = installFromQuarantine(quarantinePath, bundle, {
      name: skillName,
      overwrite: true,
      skipScan: false
    })

    // Cleanup quarantine
    rmSync(quarantinePath, { recursive: true, force: true })

    if (result.success) {
      appendAuditLog('update', {
        skill: skillName,
        old_hash: entry.content_hash,
        new_hash: newHash
      })
    }

    return result
  } catch (err: any) {
    return {
      success: false,
      name,
      path: '',
      message: `Update failed: ${err.message}`,
      error: err.message
    }
  }
}

/**
 * List installed skills
 */
export function listInstalledSkills(): LockEntry[] {
  const lock = new HubLock()
  return Object.values(lock.entries())
}
