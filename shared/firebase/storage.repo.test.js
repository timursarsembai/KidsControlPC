import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// firebase/storage is mocked so we can drive listAll/getMetadata/deleteObject.
const mockTree = {} // path -> { items: [refs], prefixes: [refs] }
const mockMeta = {}  // fullPath -> metadata
const deleted = []

vi.mock('./config.js', () => ({ storage: {} }))

vi.mock('firebase/storage', () => ({
  ref: (_storage, path) => ({ fullPath: path }),
  listAll: async (r) => {
    const node = mockTree[r.fullPath] || { items: [], prefixes: [] }
    return {
      items: node.items.map(p => ({ fullPath: p })),
      prefixes: node.prefixes.map(p => ({ fullPath: p })),
    }
  },
  getMetadata: async (r) => {
    if (!mockMeta[r.fullPath]) throw new Error('not found: ' + r.fullPath)
    return mockMeta[r.fullPath]
  },
  deleteObject: async (r) => { deleted.push(r.fullPath) },
}))

import { listAllUserFiles, deleteFilesByPaths } from './storage.repo.js'

const UID = 'owner1'

beforeEach(() => {
  for (const k of Object.keys(mockTree)) delete mockTree[k]
  for (const k of Object.keys(mockMeta)) delete mockMeta[k]
  deleted.length = 0
})

function meta(fullPath, size, timeCreated, contentType = 'application/octet-stream') {
  const name = fullPath.split('/').pop()
  mockMeta[fullPath] = { name, fullPath, size, timeCreated, contentType }
}

describe('listAllUserFiles', () => {
  it('aggregates attachments and screenshots, newest first', async () => {
    const att = `users/${UID}/chats/c1/attachments/doc.pdf`
    const ss = `users/${UID}/devices/d1/screenshots/shot.jpg`

    mockTree[`users/${UID}/chats`] = { items: [], prefixes: [`users/${UID}/chats/c1`] }
    mockTree[`users/${UID}/chats/c1`] = { items: [], prefixes: [`users/${UID}/chats/c1/attachments`] }
    mockTree[`users/${UID}/chats/c1/attachments`] = { items: [att], prefixes: [] }
    mockTree[`users/${UID}/devices`] = { items: [], prefixes: [`users/${UID}/devices/d1`] }
    mockTree[`users/${UID}/devices/d1`] = { items: [], prefixes: [`users/${UID}/devices/d1/screenshots`] }
    mockTree[`users/${UID}/devices/d1/screenshots`] = { items: [ss], prefixes: [] }

    meta(att, 1000, '2026-06-27T02:35:00Z')
    meta(ss, 2000, '2026-06-27T02:34:00Z')

    const files = await listAllUserFiles(UID)
    expect(files).toHaveLength(2)
    // newest (02:35) first
    expect(files[0].fullPath).toBe(att)
    expect(files[0].type).toBe('attachment')
    expect(files[1].type).toBe('screenshot')
    expect(files.reduce((s, f) => s + f.size, 0)).toBe(3000)
  })

  it('returns empty list when a branch is missing (no devices)', async () => {
    const att = `users/${UID}/chats/c1/attachments/doc.pdf`
    mockTree[`users/${UID}/chats`] = { items: [att], prefixes: [] }
    meta(att, 500, '2026-06-27T00:00:00Z')
    // devices branch absent -> listAll returns empty node, no throw

    const files = await listAllUserFiles(UID)
    expect(files).toHaveLength(1)
    expect(files[0].type).toBe('attachment')
  })

  it('skips files whose metadata fetch fails', async () => {
    const ok = `users/${UID}/chats/c1/attachments/ok.pdf`
    const bad = `users/${UID}/chats/c1/attachments/bad.pdf`
    mockTree[`users/${UID}/chats`] = { items: [ok, bad], prefixes: [] }
    meta(ok, 100, '2026-06-27T00:00:00Z')
    // bad has no metadata -> getMetadata throws -> filtered out

    const files = await listAllUserFiles(UID)
    expect(files.map(f => f.fullPath)).toEqual([ok])
  })
})

describe('deleteFilesByPaths', () => {
  it('deletes each path and reports progress', async () => {
    const paths = ['a/1', 'a/2', 'a/3']
    const progress = []
    const count = await deleteFilesByPaths(paths, (done, total) => progress.push([done, total]))

    expect(count).toBe(3)
    expect(deleted).toEqual(paths)
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('handles an empty list without calling progress', async () => {
    const progress = vi.fn()
    const count = await deleteFilesByPaths([], progress)
    expect(count).toBe(0)
    expect(progress).not.toHaveBeenCalled()
  })
})
