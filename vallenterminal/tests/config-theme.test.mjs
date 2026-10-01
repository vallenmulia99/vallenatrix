import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const themesDir = join(__dirname, '../themes')

// Direct test of theme schema logic
const THEME_NAME_REGEX = /^[a-z0-9][a-z0-9-_]{0,63}$/

function isValidThemeName(name) {
  return typeof name === 'string' && THEME_NAME_REGEX.test(name)
}

function validateTheme(raw) {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw
  if (!isValidThemeName(obj.name)) return null
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

test('validateTheme rejects path traversal and invalid theme names', () => {
  const dummyColors = {
    black: '#000', red: '#000', green: '#000', yellow: '#000', blue: '#000',
    magenta: '#000', cyan: '#000', white: '#000', brightBlack: '#000',
    brightRed: '#000', brightGreen: '#000', brightYellow: '#000',
    brightBlue: '#000', brightMagenta: '#000', brightCyan: '#000',
    brightWhite: '#000', foreground: '#fff', background: '#000'
  }

  assert.equal(validateTheme({ name: '../evil', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: '..\\evil', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: '/etc/passwd', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: '', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: '   ', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: 'a'.repeat(65), colors: dummyColors }), null)
  assert.equal(validateTheme({ name: 'theme with spaces', colors: dummyColors }), null)
  assert.equal(validateTheme({ name: 'THEME_UPPER', colors: dummyColors }), null)

  // Valid names
  assert.ok(validateTheme({ name: 'cyber-sakura', colors: dummyColors }) !== null)
  assert.ok(validateTheme({ name: 'theme_123', colors: dummyColors }) !== null)
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
