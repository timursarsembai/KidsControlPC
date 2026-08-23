// Which backend the data layer talks to.
//
// One switch, read once. Everything under shared/data/ re-exports from the
// implementation this picks, so a caller importing @kidscontrol/shared/data/*
// never names a backend and never has to change when Firebase goes away.
//
// Default is 'firebase': the production panel must keep working exactly as it
// does until it is deliberately pointed elsewhere.

function readEnv(name) {
  try {
    // eslint-disable-next-line no-undef
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
      // eslint-disable-next-line no-undef
      return import.meta.env[name]
    }
  } catch {
    // import.meta is unavailable in some bundling modes; fall through.
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name]
  }
  return null
}

const requested = readEnv('VITE_BACKEND') || readEnv('KIDSCONTROL_BACKEND') || 'firebase'

if (requested !== 'firebase' && requested !== 'selfhosted') {
  // A typo in the build environment would otherwise silently fall back to
  // Firebase, and the reason a deploy did not change anything would be
  // invisible.
  throw new Error(
    `Unknown backend "${requested}". Set VITE_BACKEND to "firebase" or "selfhosted".`
  )
}

export const BACKEND = requested
export const isSelfHosted = BACKEND === 'selfhosted'
