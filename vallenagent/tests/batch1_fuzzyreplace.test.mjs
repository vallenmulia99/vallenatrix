import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyReplace } from '../dist/builtin_tools.js'

test('BUG-01: unicode_normalized with unicode chars before target', (t) => {
  // Unicode chars before target should not corrupt offset
  // Content has em-dash (—), old_string has curly quotes to force unicode normalization
  const content = 'intro — dash\nconst a = "hello";\nend'
  const oldString = 'const a = \u201Chello\u201D;'  // unicode curly quotes
  const newString = 'const a = "bye";'
  
  const result = fuzzyReplace(content, oldString, newString)
  
  assert.equal(result.content, 'intro — dash\nconst a = "bye";\nend')
  assert.equal(result.strategy, 'unicode_normalized')
})

test('BUG-01: unicode_normalized honors replaceAll', (t) => {
  const result = fuzzyReplace(
    'x = "a"\ny = "a"',
    '= "a"',
    '= "b"',
    true
  )
  
  assert.ok(result.content.includes('x = "b"'))
  assert.ok(result.content.includes('y = "b"'))
})

test('BUG-02: whitespace_normalized must not use includes()', (t) => {
  // With includes() removed, partial match should fail or use different strategy
  const content = 'function f() {\n  return  foo(1)  +  bar(2);\n}\n'
  const oldStr = 'foo(1) + bar(2)'
  
  try {
    const result = fuzzyReplace(content, oldStr, 'X')
    // If it succeeds, must preserve 'return' and ';'
    assert.ok(result.content.includes('return'), 'Must preserve "return"')
    assert.ok(result.content.includes('X'), 'Must have replacement')
    assert.ok(result.content.includes(';'), 'Must preserve ";"')
  } catch (err) {
    // If no match found, that's also acceptable (better than corrupting)
    assert.ok(err.message.includes('Failed to find unique match'))
  }
})

test('BUG-03: empty old_string must throw', (t) => {
  assert.throws(() => {
    fuzzyReplace('abc', '', 'X', true)
  }, /old_string must not be empty/)
  
  assert.throws(() => {
    fuzzyReplace('abc', '', 'X', false)
  }, /old_string must not be empty/)
})
