const crypto = require('crypto')

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+='
  let password = ''
  for (let i = 0; i < length; i += 1) {
    password += alphabet[crypto.randomInt(0, alphabet.length)]
  }
  return password
}

module.exports = { tokenHash, generateToken, generatePassword }
