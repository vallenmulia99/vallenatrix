import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const themesDir = join(__dirname, '../themes')

// Direct test of theme schema logic
function validateTheme(raw) {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw
  if (typeof obj.name !== 'string' || !obj.name.trim()) return null
  if (!obj.colors || typeof obj.colors !== 'object') return null

  const colors = obj.colors
  const requiredColorKeys = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    'foreground', 'background'
  ]

  for (const key of requiredColorKeys) {
    if (typeof colors[key] !== 'string') return null
  }

  return {
    name: obj.name,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : obj.name,
    colors: obj.colors
  }
}

test('validateTheme rejects invalid themes', () => {
  assert.equal(validateTheme(null), null)
  assert.equal(validateTheme({}), null)
  assert.equal(validateTheme({ name: 'test' }), null)
  assert.equal(validateTheme({ name: 'test', colors: { black: '#000' } }), null)
})

test('all built-in themes in themes/ are valid', () => {
  const files = readdirSync(themesDir).filter(f => f.endsWith('.json'))
  assert.ok(files.length >= 5, 'Must have at least 5 built-in themes')

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(themesDir, file), 'utf-8'))
    const validated = validateTheme(raw)
    assert.ok(validated !== null, `Theme ${file} must pass validation`)
    assert.ok(validated.name.length > 0)
    assert.ok(validated.colors.foreground)
    assert.ok(validated.colors.background)
  }
})
