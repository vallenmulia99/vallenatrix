/**
 * Skills Hub Models - Types, validation, and data structures
 * Adapted from Hermes Agent skills_hub_models.py
 */

import { join, resolve, relative, sep } from 'path'
import { homedir } from 'os'

export interface SkillBundle {
  name: string
  category?: string
  description: string
  source: string
  identifier: string
  files: Record<string, string> // rel_path -> content
  metadata?: Record<string, any>
  content_hash?: string
  trust_level?: 'builtin' | 'trusted' | 'community' | 'local'
}

export interface SkillSource {
  id: string
  name: string
  url: string
  trust_level: 'builtin' | 'trusted' | 'community'
}

export interface SkillSearchResult {
  identifier: string
  name: string
  category?: string
  description: string
  source: string
  trust_level: string
  repo_url?: string
  install_command?: string
  metadata?: Record<string, any>
}

export interface LockEntry {
  name: string
  source: string
  identifier: string
  install_path: string
  installed_at: string
  content_hash: string
  files: string[] // relative paths
  metadata?: Record<string, any>
}

export interface HubLockFile {
  version: number
  skills: Record<string, LockEntry> // name -> entry
}

// Validation regex
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i
const VALID_CATEGORY = /^[a-z0-9][a-z0-9._/-]*$/i
const DANGEROUS_PATH_PARTS = /^\.{1,2}$|^~$|[\x00-\x1f]|[<>:"|?*\\]/

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate skill name (alphanumeric, dash, underscore, dot)
 */
export function validateSkillName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Skill name cannot be empty')
  }
  const trimmed = name.trim()
  if (!VALID_SKILL_NAME.test(trimmed)) {
    throw new ValidationError(
      `Invalid skill name: ${name}. Must start with letter/digit, contain only [a-zA-Z0-9._-]`
    )
  }
  if (trimmed.length > 64) {
    throw new ValidationError(`Skill name too long: ${name} (max 64 chars)`)
  }
  return trimmed
}

/**
 * Validate category path (alphanumeric, dash, underscore, slash)
 */
export function validateCategory(category: string): string {
  if (!category) return ''
  const trimmed = category.trim()
  if (!VALID_CATEGORY.test(trimmed)) {
    throw new ValidationError(
      `Invalid category: ${category}. Must contain only [a-zA-Z0-9._/-]`
    )
  }
  // No leading/trailing slashes
  const normalized = trimmed.replace(/^\/+|\/+$/g, '')
  if (normalized.length > 128) {
    throw new ValidationError(`Category path too long: ${category} (max 128 chars)`)
  }
  return normalized
}

/**
 * Validate relative path inside skill bundle (no escapes, no dangerous chars)
 */
export function validateBundleRelPath(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new ValidationError('Bundle path cannot be empty')
  }
  const normalized = relPath.trim().replace(/^\/+/, '')
  if (!normalized) {
    throw new ValidationError('Bundle path cannot be empty after normalization')
  }
  
  // Split by separator and check each part
  const parts = normalized.split('/')
  for (const part of parts) {
    if (!part) {
      throw new ValidationError(`Invalid bundle path: ${relPath} (empty component)`)
    }
    if (DANGEROUS_PATH_PARTS.test(part)) {
      throw new ValidationError(
        `Unsafe path component in bundle: ${part} (no .., ~, or dangerous chars)`
      )
    }
  }
  
  // No absolute paths
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new ValidationError(`Bundle path must be relative: ${relPath}`)
  }
  
  return normalized
}

/**
 * Validate install parent path (category)
 */
export function validateInstallParentPath(category: string): string {
  if (!category) return ''
  return validateCategory(category)
}

/**
 * Normalize lock file install path
 */
export function normalizeLockInstallPath(installPath: string, skillName: string): string {
  if (!installPath) return skillName
  // Remove leading/trailing slashes
  const normalized = installPath.trim().replace(/^\/+|\/+$/g, '')
  return normalized || skillName
}

/**
 * Get skills directory path
 */
export function getSkillsDir(): string {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return join(vallenatrixHome, 'skills')
}

/**
 * Get quarantine directory path
 */
export function getQuarantineDir(): string {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return join(vallenatrixHome, 'skills_hub', 'quarantine')
}

/**
 * Get lock file path
 */
export function getLockFilePath(): string {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return join(vallenatrixHome, 'skills_hub', '.lock.json')
}

/**
 * Get audit log path
 */
export function getAuditLogPath(): string {
  const vallenatrixHome = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  return join(vallenatrixHome, 'skills_hub', 'audit.log')
}

/**
 * Check if path is a symlink or junction (Windows)
 */
export function isPathRedirect(path: string): boolean {
  try {
    const fs = require('fs')
    const stats = fs.lstatSync(path)
    return stats.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Compute content hash for skill bundle files
 */
export function computeContentHash(files: Record<string, string>): string {
  const crypto = require('crypto')
  const hash = crypto.createHash('sha256')
  
  // Sort keys for deterministic hash
  const sortedKeys = Object.keys(files).sort()
  for (const key of sortedKeys) {
    hash.update(key)
    hash.update('\x00')
    hash.update(files[key])
    hash.update('\x00')
  }
  
  return hash.digest('hex')
}

/**
 * Parse skill identifier (format: source/category/name or github-url)
 */
export function parseSkillIdentifier(identifier: string): {
  source: string
  category?: string
  name: string
  url?: string
} {
  identifier = identifier.trim()
  
  // GitHub URL
  if (identifier.startsWith('https://github.com/') || identifier.startsWith('http://github.com/')) {
    return {
      source: 'github',
      name: identifier.split('/').pop() || 'unknown',
      url: identifier
    }
  }
  
  // official/category/name
  const parts = identifier.split('/')
  if (parts.length === 3 && parts[0] === 'official') {
    return {
      source: 'official',
      category: parts[1],
      name: parts[2]
    }
  }
  
  // category/name
  if (parts.length === 2) {
    return {
      source: 'community',
      category: parts[0],
      name: parts[1]
    }
  }
  
  // name only
  return {
    source: 'local',
    name: identifier
  }
}
