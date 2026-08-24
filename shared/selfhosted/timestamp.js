// Time values shaped the way the panel already reads them.
//
// The panel was written against Firestore, where every timestamp is an object
// with toDate() / toMillis() / .seconds — and it does that in 26 places across
// 15 files, including code shared with the Electron app that still runs on
// Firebase. A plain ISO string makes `device.lastSeen?.toDate?.()` return
// undefined, and the caller then decides the device has never been seen: a
// perfectly healthy PC shows as offline forever.
//
// So the conversion happens here, at the seam, rather than in two dozen
// components. When Firebase is removed this file goes with it, and the panel
// switches to plain dates in one pass.
//
// valueOf is what makes `new Date(value)` work too, so call sites that skip
// toDate() and construct a date directly get the right answer as well.

export function timestamp(isoString) {
  if (!isoString) return null

  const millis = Date.parse(isoString)
  if (Number.isNaN(millis)) return null

  return {
    toDate: () => new Date(millis),
    toMillis: () => millis,
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1e6,
    valueOf: () => millis,
    // Survives JSON.stringify as the string it came from, so anything cached
    // or logged stays readable.
    toJSON: () => isoString,
    toString: () => isoString
  }
}

/**
 * Converts the named fields of a row in place.
 *
 * Takes the object rather than returning a new one: these come straight from
 * the API and are not shared with anything yet.
 */
export function withTimestamps(row, fields) {
  if (!row) return row
  for (const field of fields) {
    if (row[field]) row[field] = timestamp(row[field])
  }
  return row
}
