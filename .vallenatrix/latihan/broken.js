// Target latihan Ronde 3: file ini sengaja masih salah.
// Bug 1: fungsi stats() menjumlahkan string, bukan angka.
// Bug 2: average() membagi dengan angka tetap.

function stats(numbers) {
  let total = ''
  for (const value of numbers) {
    total = total + value
  }
  const average = total / 5
  return { total, average }
}

module.exports = { stats }

if (require.main === module) {
  console.log(stats([2, 4, 6]))
}
