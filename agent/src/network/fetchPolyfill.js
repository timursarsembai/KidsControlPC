import nodeFetch, { Headers, Request, Response } from 'node-fetch'
// Firebase Auth Web SDK requires a working fetch implementation.
// In pkg/Node.js, the native globalThis.fetch may be absent or non-functional.
// node-fetch v2 uses Node.js http/https modules which always work in pkg.
if (typeof globalThis.fetch !== 'function' || globalThis.__fetchPolyfilled) {
  globalThis.fetch = nodeFetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
  globalThis.__fetchPolyfilled = true
}
