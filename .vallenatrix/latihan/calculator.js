function add(a, b) { return a + b }
function subtract(a, b) { return a - b }
function multiply(a, b) { return a * b }
function divide(a, b) {
  if (b === 0) throw new Error('Tidak bisa membagi dengan nol')
  return a / b
}

module.exports = { add, subtract, multiply, divide }

if (require.main === module) {
  const assert = require('node:assert')
  assert.strictEqual(add(2, 3), 5)
  assert.strictEqual(subtract(5, 3), 2)
  assert.strictEqual(multiply(4, 3), 12)
  assert.strictEqual(divide(12, 4), 3)
  assert.throws(() => divide(1, 0), /bukan nol|nol/)
  try { divide(1, 0) } catch (err) { console.log('divide(1,0) ->', err.message) }
  console.log('self-check kalkulator: OK')
}
