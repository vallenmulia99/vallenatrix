/**
 * Skills Hub Lock File - Track installed skills
 * Adapted from Hermes Agent HubLockFile
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { HubLockFile, LockEntry } from './skills_hub_models'
import { getLockFilePath } from './skills_hub_models'

export class HubLock {
  private lockPath: string
  private data: HubLockFile

  constructor() {
    this.lockPath = getLockFilePath()
    this.data = this.load()
  }

  /**
   * Load lock file from disk
   */
  private load(): HubLockFile {
    if (!existsSync(this.lockPath)) {
      return { version: 1, skills: {} }
    }

    try {
      const content = readFileSync(this.lockPath, 'utf-8')
      const parsed = JSON.parse(content)
      return {
        version: parsed.version || 1,
        skills: parsed.skills || {}
      }
    } catch (err) {
      console.warn(`[HubLock] Failed to parse lock file, starting fresh:`, err)
      return { version: 1, skills: {} }
    }
  }

  /**
   * Save lock file to disk
   */
  save(): void {
    try {
      const dir = dirname(this.lockPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.lockPath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[HubLock] Failed to save lock file:`, err)
      throw err
    }
  }

  /**
   * Get entry by skill name
   */
  get(name: string): LockEntry | undefined {
    return this.data.skills[name]
  }

  /**
   * Check if skill is installed
   */
  has(name: string): boolean {
    return name in this.data.skills
  }

  /**
   * Add or update skill entry
   */
  set(name: string, entry: LockEntry): void {
    this.data.skills[name] = entry
    this.save()
  }

  /**
   * Remove skill entry
   */
  delete(name: string): boolean {
    if (!this.has(name)) {
      return false
    }
    delete this.data.skills[name]
    this.save()
    return true
  }

  /**
   * List all installed skill names
   */
  list(): string[] {
    return Object.keys(this.data.skills)
  }

  /**
   * Get all entries
   */
  entries(): Record<string, LockEntry> {
    return { ...this.data.skills }
  }

  /**
   * Clear all entries (dangerous!)
   */
  clear(): void {
    this.data.skills = {}
    this.save()
  }

  /**
   * Get skills by source
   */
  bySource(source: string): LockEntry[] {
    return Object.values(this.data.skills).filter(entry => entry.source === source)
  }

  /**
   * Check if content hash matches (for update detection)
   */
  hasChanged(name: string, newHash: string): boolean {
    const entry = this.get(name)
    if (!entry) return true
    return entry.content_hash !== newHash
  }

  /**
   * Validate lock file integrity
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!this.data.version) {
      errors.push('Missing version field')
    }

    if (!this.data.skills || typeof this.data.skills !== 'object') {
      errors.push('Invalid skills field')
      return { valid: false, errors }
    }

    for (const [name, entry] of Object.entries(this.data.skills)) {
      if (!entry.name) {
        errors.push(`Entry ${name} missing name field`)
      }
      if (!entry.source) {
        errors.push(`Entry ${name} missing source field`)
      }
      if (!entry.identifier) {
        errors.push(`Entry ${name} missing identifier field`)
      }
      if (!entry.install_path) {
        errors.push(`Entry ${name} missing install_path field`)
      }
      if (!entry.installed_at) {
        errors.push(`Entry ${name} missing installed_at field`)
      }
      if (!entry.content_hash) {
        errors.push(`Entry ${name} missing content_hash field`)
      }
      if (!Array.isArray(entry.files)) {
        errors.push(`Entry ${name} has invalid files field`)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Repair corrupted lock file
   */
  repair(): void {
    const { valid, errors } = this.validate()
    if (valid) return

    console.warn(`[HubLock] Repairing lock file (${errors.length} errors)`)

    // Remove invalid entries
    const validSkills: Record<string, LockEntry> = {}
    for (const [name, entry] of Object.entries(this.data.skills)) {
      if (entry.name && entry.source && entry.identifier && entry.install_path &&
          entry.installed_at && entry.content_hash && Array.isArray(entry.files)) {
        validSkills[name] = entry
      } else {
        console.warn(`[HubLock] Removing invalid entry: ${name}`)
      }
    }

    this.data.skills = validSkills
    this.save()
  }
}

/**
 * Append to audit log
 */
export function appendAuditLog(action: string, details: Record<string, any>): void {
  try {
    const { getAuditLogPath } = require('./skills_hub_models')
    const logPath = getAuditLogPath()
    const dir = dirname(logPath)
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const timestamp = new Date().toISOString()
    const entry = JSON.stringify({ timestamp, action, ...details })
    
    const { appendFileSync } = require('fs')
    appendFileSync(logPath, entry + '\n', 'utf-8')
  } catch (err) {
    console.warn(`[HubLock] Failed to append audit log:`, err)
  }
}
