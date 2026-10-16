import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
const pet = readFileSync(join(root, 'src/renderer/pet.ts'), 'utf8')

test('walking and sleeping emoji pets receive animated poses despite global motion reset', () => {
  assert.match(pet, /pose = frame === FRAMES\.sleep[\s\S]*?: 'walk'/)
  assert.match(html, /\.pet-emoji\.walk \{ animation: pet-bob 420ms steps\(2, end\) infinite !important;/)
  assert.match(html, /\.pet-emoji\.sleep \{ animation: pet-sleep[^}]+!important;/)
  assert.match(html, /\.pet-robot \{ background:[^}]*var\(--pet-accent\)/)
  assert.match(html, /\.pet-slime \{ background:[^}]*var\(--pet-accent\)/)
  assert.match(html, /\.pet-fox, \.pet-kitsune \{ background: linear-gradient\(90deg, #fff[^}]+#d94150/)
})

test('pet animation timer pauses while renderer is hidden and resumes when visible', () => {
  assert.match(pet, /private pageVisible = !document\.hidden/)
  assert.match(pet, /document\.addEventListener\('visibilitychange', this\.onVisibilityChange\)/)
  assert.match(pet, /if \(this\.loopId !== null \|\| !this\.pageVisible\) return/)
  assert.match(pet, /if \(this\.pageVisible && this\.enabled\) this\.start\(\)\s*else this\.stop\(\)/)
})
