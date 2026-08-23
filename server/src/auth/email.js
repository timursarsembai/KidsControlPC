// Lowercase and trim, and nothing else.
//
// Tempting extras — stripping dots or +tags for Gmail — are deliberately not
// done: they make two addresses the parent considers different collide, and
// the surprise only surfaces when someone cannot register.

export function normalizeEmail(input) {
  if (typeof input !== 'string') return ''
  return input.trim().toLowerCase()
}

// Rough shape check only. The authority on whether an address works is a
// delivered message, not a regex, and elaborate patterns reject valid
// addresses far more often than they catch typos.
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function looksLikeEmail(value) {
  return typeof value === 'string' && value.length <= 254 && SHAPE.test(value)
}
