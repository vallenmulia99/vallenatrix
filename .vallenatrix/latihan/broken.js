// Diperbaiki: total mulai dari 0 (angka, bukan string) dan average dibagi panjang array.

function stats(numbers) {
  let total = 0
  for (const value of numbers) {
    total = total + value
  }
  const average = numbers.length === 0 ? 0 : total / numbers.length
  return { total, average }
}

module.exports = { stats }

if (require.main === module) {
  console.log(stats([2, 4, 6]))
}
