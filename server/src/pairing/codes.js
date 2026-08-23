import { randomInt } from 'node:crypto'

// No I, O, 0 or 1. The code is read off a parent's screen and typed on a
// child's PC, often by the child — every pair that looks alike is a support
// call. Same alphabet as the Cloud Function it replaces, so codes issued by
// either backend look the same to the person typing them.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

export function generatePairingCode() {
  let code = ''
  // randomInt, not Math.random: the code is a credential for the whole
  // account until it is used.
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return code
}

// Accepts what a person actually types: lowercase, spaces, a dash in the
// middle. Returns '' for anything that cannot be a code, so the caller can
// reject it without a second validation rule.
export function normalizePairingCode(input) {
  if (typeof input !== 'string') return ''
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== CODE_LENGTH) return ''
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return ''
  }
  return cleaned
}
