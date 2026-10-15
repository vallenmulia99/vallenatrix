#!/usr/bin/env node
/**
 * measure_prompt_cost.mjs — ukur biaya prompt per iterasi Vallenatrix.
 *
 * Memakai SkillLoader asli (bukan parser tiruan), jadi angka yang keluar
 * sama dengan yang benar-benar dikirim ke model.
 *
 *   node tools/measure_prompt_cost.mjs
 *   node tools/measure_prompt_cost.mjs --json
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

// --- 1. Tools: yang benar-benar dikirim ke provider setiap iterasi ---
const builtin = readFileSync(join(ROOT, 'vallenagent/src/builtin_tools.ts'), 'utf8')
const toolNames = [...new Set(
  [...builtin.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1]).filter(n => n !== '9router')
)]

// Ukuran schema nyata dihitung dari schema yang di-build, bukan dari sumber.
const { registry } = require(join(ROOT, 'vallenagent/dist/tools.js'))
require(join(ROOT, 'vallenagent/dist/builtin_tools.js')).registerBuiltinTools()
const schemas = registry.getOpenAISchemas([], undefined)
const schemaChars = JSON.stringify(schemas).length

// --- 2. Skill index: persis output getFormattedIndex() ---
const { SkillLoader } = require(join(ROOT, 'vallenagent/dist/skills.js'))
const skillDirs = [
  join(homedir(), '.vallenatrix/skills'),
  join(ROOT, '.vallenatrix/skills')
]
const loader = new SkillLoader(skillDirs)
loader.load()
const skills = loader.list()
const index = loader.getFormattedIndex()

// Duplikat muncul saat skill yang sama ada di profil user DAN di repo bundled.
const userLoader = new SkillLoader(skillDirs.slice(0, 1))
userLoader.load()
const repoLoader = new SkillLoader(skillDirs.slice(1))
repoLoader.load()
const userNames = new Set(userLoader.list().map(s => s.name))
const repoNames = repoLoader.list().map(s => s.name)
const duplicates = repoNames.filter(n => userNames.has(n))
const est = chars => Math.ceil(chars / 4)
const total = est(schemaChars) + est(index.length)

const report = {
  tools: { count: toolNames.length, schemaTokens: est(schemaChars) },
  skills: {
    count: skills.length,
    categories: [...new Set(skills.map(s => s.metadata.category || 'general'))].length,
    uncategorised: skills.filter(s => !s.metadata.category || s.metadata.category === 'general').length,
    indexChars: index.length,
    indexTokens: est(index.length)
  },
  fixedPerRequestTokens: total,
  historyTokensGrow: 'riwayat + system prompt dikirim ulang tiap iterasi; tumbuh selama turn',
  duplicateSkills: duplicates
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('=== biaya prompt tetap per iterasi ===')
  console.log(`  tool dikirim        : ${report.tools.count}`)
  console.log(`  schema (JSON nyata) : ${schemaChars} char (~${report.tools.schemaTokens} token)`)
  console.log(`  skill ter-index     : ${report.skills.count} skill / ${report.skills.categories} kategori`)
  console.log(`    tanpa kategori    : ${report.skills.uncategorised} skill (frontmatter tidak punya category dan tidak ada folder kategori)`)
  console.log(`  index skill         : ${report.skills.indexChars} char (~${report.skills.indexTokens} token)`)
  console.log(`  TOTAL               : ~${report.fixedPerRequestTokens} token`)
  console.log(`  duplikat profil/bundled: ${report.duplicateSkills.length} skill`)
  console.log(`  ${report.historyTokensGrow}`)
}

// Self-check: jangan lapor angka palsu kalau registry/loader tidak jalan.
if (schemas.length === 0) {
  console.error('SELF-CHECK GAGAL: registry tidak mengembalikan schema. Jalankan `npm -w vallenagent run build` dulu.')
  process.exit(1)
}
if (skills.length === 0) {
  console.error('SELF-CHECK GAGAL: SkillLoader tidak menemukan skill. Cek folder skill.')
  process.exit(1)
}
if (toolNames.length < 10) {
  console.error('SELF-CHECK GAGAL: parser nama tool tidak menemukan tool di builtin_tools.ts.')
  process.exit(1)
}
