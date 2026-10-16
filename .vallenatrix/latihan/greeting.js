function greet(name) {
  return `Halo, ${name}!`
}

function shout(name) {
  return greet(name).toUpperCase()
}

module.exports = { greet, shout }

if (require.main === module) {
  console.log(greet('rudi'))
}
