import nodeFetch, { Headers, Request, Response } from 'node-fetch'
// Firebase Auth Web SDK requires a working fetch implementation, including for the
// hourly ID-token refresh. Node 18 (the pkg target) does expose globalThis.fetch via
// undici, but undici is unreliable inside pkg-packaged executables — the same reason
// callCF() talks to Cloud Functions over the raw https module. node-fetch v2 is built
// on node:http/https, which always works in pkg, so install it unconditionally.
if (!globalThis.__fetchPolyfilled) {
  globalThis.fetch = nodeFetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
  globalThis.__fetchPolyfilled = true
}
