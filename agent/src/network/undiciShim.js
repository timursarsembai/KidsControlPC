// @firebase/auth's Node build does `import { fetch, Headers, Response } from 'undici'`
// and hands them to FetchProvider, bypassing globalThis.fetch entirely. undici does not
// work inside pkg-packaged executables — the same reason callCF() talks to Cloud
// Functions over the raw https module — so signInWithCustomToken always failed with
// auth/network-request-failed and the agent fell back to unauthenticated mode.
//
// The build aliases 'undici' to this module. node-fetch v2 is built on node:http/https,
// which works under pkg, and covers the small surface Auth actually uses: calling fetch,
// reading response.status/ok and response.json(), and constructing Headers.
import nodeFetch, { Headers, Request, Response, FetchError } from 'node-fetch'

export { Headers, Request, Response, FetchError }
export const fetch = nodeFetch
export default { fetch: nodeFetch, Headers, Request, Response, FetchError }
