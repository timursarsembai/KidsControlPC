// HTTP client for the self-hosted API: attaches the access token, refreshes it
// once when it has expired, and turns error bodies into throwable objects.

import { API_BASE_URL, API_PREFIX } from './config.js'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokens.js'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function url(path) {
  return `${API_BASE_URL}${API_PREFIX}${path}`
}

async function parse(response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(response.status, 'bad_response', 'Сервер вернул неразборчивый ответ.')
  }
}

// One refresh at a time. Without this, a screen that fires five requests at
// once on load would run five refreshes in parallel — and since every refresh
// rotates the token, four of them would present an already-spent one, which
// the server correctly treats as a stolen token and answers by ending every
// session the parent has.
let refreshInFlight = null

export async function refreshSession() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(url('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        })
        if (!response.ok) {
          clearTokens()
          return false
        }
        const data = await parse(response)
        setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
        return true
      } catch {
        // Network failure, not a rejected token: keep what we have and let the
        // caller fail this one request. Clearing here would sign a parent out
        // every time their wifi hiccuped.
        return false
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

export async function request(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const token = auth ? getAccessToken() : null
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (err) {
    throw new ApiError(0, 'network_error', err.message)
  }

  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshSession()
    if (refreshed) {
      return request(path, { method, body, auth, retry: false })
    }
  }

  const data = await parse(response)
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code, data?.error?.message)
  }
  return data
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' })
}
