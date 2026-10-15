/**
 * Skills Hub Slash Commands - /skills subcommands for CLI
 */

import { join } from 'path'

export async function handleSkillsCommand(trimmed: string, agent: any, __dirname: string): Promise<any> {
  // Just /skills - show loaded + help
  if (trimmed === '/skills') {
    const skills = agent.skillLoader.list()
    const byCat: Record<string, string[]> = {}
    for (const s of skills) {
      const cat = s.metadata.category || 'general'
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push(s.name)
    }
    const lines = ['\x1b[36m[Available Skills]\x1b[0m']
    for (const [cat, sks] of Object.entries(byCat)) {
      lines.push(`\x1b[33m${cat}\x1b[0m: ${sks.join(', ')}`)
    }
    lines.push('\n\x1b[2mUse:\x1b[0m')
    lines.push('  /skills search <query>    - Search hub for skills')
    lines.push('  /skills install <id>      - Install from GitHub/official')
    lines.push('  /skills uninstall <name>  - Remove skill')
    lines.push('  /skills update <name>     - Update skill')
    lines.push('  /skills installed         - Show installed skills')
    lines.push('  /skills disable <name>    - Disable skill (skip load)')
    lines.push('  /skills enable <name>     - Enable disabled skill')
    lines.push('  /skills disabled          - List disabled skills')
    lines.push('  /skills sync              - Sync bundled skills')
    lines.push('  /skills reset <name>      - Reset skill to bundled version')
    return { response: lines.join('\n') }
  }

  // Parse subcommand
  const parts = trimmed.split(/\s+/)
  const subcommand = parts[1]

  if (subcommand === 'search') {
    const query = parts.slice(2).join(' ').trim()
    if (!query) {
      return { response: '\x1b[31mUsage: /skills search <query>\x1b[0m' }
    }

    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { searchSkills } = require(vallenagentDist.replace('/index.js', '/skills_hub_search.js'))
      const results = await searchSkills({ query, limit: 10 })

      if (results.length === 0) {
        return { response: `\x1b[33mNo skills found for: ${query}\x1b[0m` }
      }

      const lines = [`\x1b[36m[Skills Search: ${query}]\x1b[0m\n`]
      for (const r of results) {
        const trust = r.trust_level === 'builtin' ? '\x1b[32m[official]\x1b[0m' :
                      r.trust_level === 'trusted' ? '\x1b[36m[trusted]\x1b[0m' :
                      '\x1b[33m[community]\x1b[0m'
        lines.push(`${trust} \x1b[1m${r.name}\x1b[0m`)
        lines.push(`  ${r.description}`)
        lines.push(`  \x1b[2m${r.install_command}\x1b[0m\n`)
      }
      return { response: lines.join('\n') }
    } catch (err: any) {
      return { response: `\x1b[31m[Search Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'install') {
    const identifier = parts.slice(2).join(' ').trim()
    if (!identifier) {
      return { response: '\x1b[31mUsage: /skills install <github-url|official/category/name>\x1b[0m' }
    }

    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { parseSkillIdentifier } = require(vallenagentDist.replace('/index.js', '/skills_hub_models.js'))
      const { fetchGitHubSkill, fetchOfficialSkill } = require(vallenagentDist.replace('/index.js', '/skills_hub_search.js'))
      const { quarantineBundle, installFromQuarantine } = require(vallenagentDist.replace('/index.js', '/skills_hub_install.js'))

      const parsed = parseSkillIdentifier(identifier)
      let bundle

      if (parsed.source === 'github' && parsed.url) {
        bundle = await fetchGitHubSkill(parsed.url)
      } else if (parsed.source === 'official' && parsed.category) {
        bundle = await fetchOfficialSkill(parsed.category, parsed.name)
      } else {
        return { response: `\x1b[31mUnsupported identifier format. Use GitHub URL or official/category/name\x1b[0m` }
      }

      const quarantinePath = quarantineBundle(bundle)
      const result = installFromQuarantine(quarantinePath, bundle, { overwrite: false })

      const { rmSync } = require('fs')
      rmSync(quarantinePath, { recursive: true, force: true })

      if (result.success) {
        agent.skillLoader.scanAll()
        return { response: `\x1b[32m${result.message}\x1b[0m\nPath: ${result.path}` }
      } else {
        return { response: `\x1b[31m[Install Failed]\x1b[0m ${result.message}` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Install Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'uninstall') {
    const name = parts[2]
    if (!name) {
      return { response: '\x1b[31mUsage: /skills uninstall <skill-name>\x1b[0m' }
    }

    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { uninstallSkill } = require(vallenagentDist.replace('/index.js', '/skills_hub_install.js'))
      const result = uninstallSkill(name)

      if (result.success) {
        agent.skillLoader.scanAll()
        return { response: `\x1b[32m${result.message}\x1b[0m` }
      } else {
        return { response: `\x1b[31m[Uninstall Failed]\x1b[0m ${result.message}` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Uninstall Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'update') {
    const name = parts[2]
    if (!name) {
      return { response: '\x1b[31mUsage: /skills update <skill-name>\x1b[0m' }
    }

    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { updateSkill } = require(vallenagentDist.replace('/index.js', '/skills_hub_install.js'))
      const result = await updateSkill(name)

      if (result.success) {
        agent.skillLoader.scanAll()
        return { response: `\x1b[32m${result.message}\x1b[0m` }
      } else {
        return { response: `\x1b[31m[Update Failed]\x1b[0m ${result.message}` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Update Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'installed') {
    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { listInstalledSkills } = require(vallenagentDist.replace('/index.js', '/skills_hub_install.js'))
      const installed = listInstalledSkills()

      if (installed.length === 0) {
        return { response: '\x1b[33mNo skills installed via hub yet.\x1b[0m' }
      }

      const lines = ['\x1b[36m[Installed Skills]\x1b[0m\n']
      for (const s of installed) {
        const source = s.source === 'official' ? '\x1b[32m[official]\x1b[0m' :
                       s.source === 'github' ? '\x1b[36m[github]\x1b[0m' :
                       '\x1b[33m[local]\x1b[0m'
        lines.push(`${source} \x1b[1m${s.name}\x1b[0m`)
        lines.push(`  Path: ${s.install_path}`)
        lines.push(`  Installed: ${s.installed_at.split('T')[0]}\n`)
      }
      return { response: lines.join('\n') }
    } catch (err: any) {
      return { response: `\x1b[31m[List Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'disable') {
    const name = parts[2]
    if (!name) {
      return { response: '\x1b[31mUsage: /skills disable <skill-name>\x1b[0m' }
    }

    try {
      if (agent.skillLoader.disable(name)) {
        // Save to config
        const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
        const { saveConfig } = require(vallenagentDist.replace('/index.js', '/config.js'))
        const cfg = agent.getConfig()
        if (!cfg.skills) cfg.skills = { paths: [] }
        if (!cfg.skills.disabled) cfg.skills.disabled = []
        if (!cfg.skills.disabled.includes(name)) {
          cfg.skills.disabled.push(name)
        }
        saveConfig(cfg)
        return { response: `\x1b[32m✓ Disabled skill '${name}'\x1b[0m\nSkill will be skipped on next load.` }
      } else {
        return { response: `\x1b[33mSkill '${name}' is already disabled or not found.\x1b[0m` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Disable Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'enable') {
    const name = parts[2]
    if (!name) {
      return { response: '\x1b[31mUsage: /skills enable <skill-name>\x1b[0m' }
    }

    try {
      if (agent.skillLoader.enable(name)) {
        // Remove from disabled config
        const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
        const { saveConfig } = require(vallenagentDist.replace('/index.js', '/config.js'))
        const cfg = agent.getConfig()
        if (cfg.skills?.disabled) {
          cfg.skills.disabled = cfg.skills.disabled.filter((n: string) => n !== name)
        }
        saveConfig(cfg)
        return { response: `\x1b[32m✓ Enabled skill '${name}'\x1b[0m\nSkill is now available.` }
      } else {
        return { response: `\x1b[33mSkill '${name}' was not disabled.\x1b[0m` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Enable Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'disabled') {
    const disabled = agent.skillLoader.getDisabled()
    if (disabled.length === 0) {
      return { response: '\x1b[33mNo disabled skills.\x1b[0m' }
    }
    const lines = ['\x1b[36m[Disabled Skills]\x1b[0m']
    for (const name of disabled) {
      lines.push(`  - ${name}`)
    }
    return { response: lines.join('\n') }
  }

  if (subcommand === 'sync') {
    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { syncBundledSkills } = require(vallenagentDist.replace('/index.js', '/skills_sync.js'))
      
      const result = syncBundledSkills({ force: false })
      const lines = ['\x1b[36m[Bundled Skills Sync]\x1b[0m']
      
      if (result.added.length > 0) {
        lines.push(`\n\x1b[32m✓ Added (${result.added.length}):\x1b[0m`)
        for (const name of result.added) {
          lines.push(`  - ${name}`)
        }
      }
      
      if (result.updated.length > 0) {
        lines.push(`\n\x1b[33m↑ Updated (${result.updated.length}):\x1b[0m`)
        for (const name of result.updated) {
          lines.push(`  - ${name}`)
        }
      }
      
      if (result.skipped.length > 0) {
        lines.push(`\n\x1b[2m→ Skipped (user modified, ${result.skipped.length}):\x1b[0m`)
        for (const name of result.skipped) {
          lines.push(`  - ${name}`)
        }
      }
      
      if (result.errors.length > 0) {
        lines.push(`\n\x1b[31m✗ Errors (${result.errors.length}):\x1b[0m`)
        for (const { skill, error } of result.errors) {
          lines.push(`  - ${skill}: ${error}`)
        }
      }
      
      if (result.added.length === 0 && result.updated.length === 0 && result.errors.length === 0) {
        lines.push('\n\x1b[32mAll bundled skills up to date.\x1b[0m')
      }
      
      // Reload skills
      agent.reload()
      
      return { response: lines.join('\n') }
    } catch (err: any) {
      return { response: `\x1b[31m[Sync Error]\x1b[0m ${err.message}` }
    }
  }

  if (subcommand === 'reset') {
    const name = parts[2]
    if (!name) {
      return { response: '\x1b[31mUsage: /skills reset <skill-name>\x1b[0m' }
    }

    try {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { resetSkill } = require(vallenagentDist.replace('/index.js', '/skills_sync.js'))
      
      const result = resetSkill(name)
      if (result.success) {
        agent.reload()
        return { response: `\x1b[32m✓ ${result.message}\x1b[0m` }
      } else {
        return { response: `\x1b[31m✗ ${result.message}\x1b[0m` }
      }
    } catch (err: any) {
      return { response: `\x1b[31m[Reset Error]\x1b[0m ${err.message}` }
    }
  }

  return { response: `\x1b[31mUnknown /skills subcommand: ${subcommand}\x1b[0m\nUse /skills for help.` }
}
