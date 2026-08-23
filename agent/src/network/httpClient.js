// HTTP for the self-hosted backend, on the raw https module.
//
// Not fetch, and not any library built on undici: this agent is packaged with
// pkg on Node.js 18.5, where global fetch and undici do not work. That is the
// same reason the Firebase build talks to Cloud Functions through https
// directly — an SDK that pulled in undici took authentication down with it and
// the failure looked like a network problem for days.
//
// Anything added here must keep that rule: node:https, or node-fetch v2, and
// nothing else.

import http from 'http'
import https from 'https'
import { URL } from 'url'
import { API_BASE_URL, API_PREFIX } from '../config.js'

const DEFAULT_TIMEOUT_MS = 20_000

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

let accessToken = null
let tokenExpiresAtMs = 0

export function setAccessToken(token, expiresInSec) {
  accessToken = token
  // Renew a minute early: a token that expires mid-request costs a round trip
  // and a retry on a link that may be slow to begin with.
  tokenExpiresAtMs = expiresInSec ? Date.now() + (expiresInSec - 60) * 1000 : 0
}

export function clearAccessToken() {
  accessToken = null
  tokenExpiresAtMs = 0
}

export function getAccessToken() {
  return accessToken
}

export function isTokenExpired() {
  return !accessToken || (tokenExpiresAtMs > 0 && Date.now() >= tokenExpiresAtMs)
}

/**
 * One request. Rejects with HttpError on anything but 2xx, and with a plain
 * Error on transport failure — callers distinguish "the server said no" from
 * "there is no server right now", because only the first is worth acting on.
 */
export function request(path, { method = 'GET', body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(`${API_BASE_URL}${API_PREFIX}${path}`)
    } catch (err) {
      reject(new Error(`Bad API URL: ${err.message}`))
      return
    }

    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const headers = { Accept: 'application/json' }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = payload.length
    }
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`

    const transport = url.protocol === 'http:' ? http : https
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      // The default has no timeout at all: a half-open connection after a
      // Windows resume would leave this promise pending for the rest of the
      // agent's life.
      timeout: timeoutMs
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        let data = null
        if (raw) {
          try {
            data = JSON.parse(raw)
          } catch {
            reject(new HttpError(res.statusCode, 'bad_response', 'Malformed response from server'))
            return
          }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new HttpError(res.statusCode, data?.error?.code, data?.error?.message))
        }
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body })
}
