// Where the self-hosted backend lives, and how the client is told about it.
//
// Vite replaces import.meta.env at build time; Node (tests, scripts) has
// process.env and no import.meta.env at all. Reading both means the same
// module works in the panel, in Electron and in a bare node --test run.

function readEnv(name) {
  try {
    // eslint-disable-next-line no-undef
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
      // eslint-disable-next-line no-undef
      return import.meta.env[name]
    }
  } catch {
    // import.meta is a syntax-level construct in some bundlers; ignore.
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name]
  }
  return null
}

export const API_BASE_URL =
  readEnv('VITE_API_BASE_URL') ||
  readEnv('KIDSCONTROL_API_BASE_URL') ||
  'https://api.kidscontrol.kz'

// ws:// for a plain http API, wss:// otherwise — deriving it from the API URL
// means one setting to get wrong instead of two that can disagree.
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')

export const API_PREFIX = '/api/v1'
