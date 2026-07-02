import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Firebase before importing the module under test
vi.mock('../network/firebaseSync.js', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn().mockResolvedValue({}),
  collection: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue({}),
  increment: vi.fn(n => ({ _increment: n })),
  serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
}))
vi.mock('./programInventory.js', () => ({
  getInstalledBasenames: vi.fn(() => null),
  getInstalledPathPrefixes: vi.fn(() => null),
  getInstalledNameMap: vi.fn(() => null),
}))

import { isSystemByPattern, trackAppDelta } from './activityTracker.js'
import { getInstalledBasenames, getInstalledPathPrefixes } from './programInventory.js'
import { addDoc } from 'firebase/firestore'

// Factory for process objects
const proc = (overrides = {}) => ({
  name: 'app',
  base: 'app',
  path: 'c:\\apps\\app.exe',
  hasWindow: true,
  sessionId: 1,
  windowTitle: 'App Window',
  ...overrides,
})

describe('isSystemByPattern', () => {
  describe('prefix rules → true', () => {
    it.each([
      'kca_setup_1.2',
      'microsoftedge_x64_149',
      'am_delta_patch_1.453',
      'onedriveupdater',
      'onedrivesetup',
    ])('%s is system', (name) => {
      expect(isSystemByPattern(name)).toBe(true)
    })
  })

  it('onedrive without updat/setup is not system', () => {
    expect(isSystemByPattern('onedrive')).toBe(false)
  })

  describe('version pattern (digit after underscore) → true', () => {
    it.each(['foo_1bar', 'app_2024', 'tool_3'])('%s is system', (name) => {
      expect(isSystemByPattern(name)).toBe(true)
    })
  })

  it('underscore without digit is not system', () => {
    expect(isSystemByPattern('foo_bar')).toBe(false)
    expect(isSystemByPattern('my_app')).toBe(false)
  })

  describe('suffix rules → true', () => {
    it.each([
      'teamviewerservice',
      'battlehost',
      'gameagent',
      'desktophelper',
      'appbroker',
      'myupdater',
    ])('%s is system', (name) => {
      expect(isSystemByPattern(name)).toBe(true)
    })
  })

  describe('whitelist exceptions → false', () => {
    it.each(['explorer', 'taskmgr'])('%s is not system', (name) => {
      expect(isSystemByPattern(name)).toBe(false)
    })
  })

  it('common user apps are not system', () => {
    expect(isSystemByPattern('chrome')).toBe(false)
    expect(isSystemByPattern('roblox')).toBe(false)
    expect(isSystemByPattern('discord')).toBe(false)
    expect(isSystemByPattern('firefox')).toBe(false)
  })

  describe('edge cases → false', () => {
    it.each([null, undefined, ''])('returns false for %s', (name) => {
      expect(isSystemByPattern(name)).toBe(false)
    })
  })
})

describe('trackAppDelta — process filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Two-call helper: first call initialises state, second detects launches
  async function deltaWith(processes, whitelist = null, pathPrefixes = null) {
    getInstalledBasenames.mockReturnValue(whitelist)
    getInstalledPathPrefixes.mockReturnValue(pathPrefixes)
    await trackAppDelta([], 'uid', 'dev')
    addDoc.mockClear()
    await trackAppDelta(processes, 'uid', 'dev')
    return addDoc.mock.calls.map(c => c[1])
  }

  it('filters process with sessionId=0', async () => {
    const events = await deltaWith([proc({ sessionId: 0 })])
    expect(events).toHaveLength(0)
  })

  it('filters process without window handle', async () => {
    const events = await deltaWith([proc({ hasWindow: false })])
    expect(events).toHaveLength(0)
  })

  it('filters process in SYSTEM_BLOCKLIST', async () => {
    const events = await deltaWith([proc({ base: 'svchost', name: 'svchost' })])
    expect(events).toHaveLength(0)
  })

  it('whitelist bypass: installed app with "host" suffix passes pattern filter', async () => {
    const whitelist = new Set(['battlehost'])
    const events = await deltaWith(
      [proc({ base: 'battlehost', name: 'battlehost', path: 'c:\\games\\battlehost.exe' })],
      whitelist
    )
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('app_launch')
  })

  it('non-whitelisted process with "host" suffix is filtered', async () => {
    const whitelist = new Set(['someotheragent'])
    const events = await deltaWith(
      [proc({ base: 'unknownhost', name: 'unknownhost' })],
      whitelist
    )
    expect(events).toHaveLength(0)
  })

  it('Windows builtin with c:\\windows\\ path and window title passes', async () => {
    const whitelist = new Set()
    const events = await deltaWith(
      [proc({ base: 'notepad', name: 'notepad', path: 'c:\\windows\\system32\\notepad.exe', windowTitle: 'Untitled - Notepad' })],
      whitelist
    )
    expect(events).toHaveLength(1)
  })

  it('Windows path without window title is filtered', async () => {
    const whitelist = new Set()
    const events = await deltaWith(
      [proc({ base: 'something', name: 'something', path: 'c:\\windows\\system32\\something.exe', windowTitle: '' })],
      whitelist
    )
    expect(events).toHaveLength(0)
  })

  it('path prefix fallback allows process from known install dir', async () => {
    const whitelist = new Set()
    const prefixes = ['c:\\program files\\myapp']
    const events = await deltaWith(
      [proc({ base: 'myapp', name: 'myapp', path: 'c:\\program files\\myapp\\myapp.exe' })],
      whitelist,
      prefixes
    )
    expect(events).toHaveLength(1)
  })

  it('path not matching any prefix is filtered', async () => {
    const whitelist = new Set()
    const prefixes = ['c:\\program files\\otherapp']
    const events = await deltaWith(
      [proc({ base: 'unknown', name: 'unknown', path: 'c:\\random\\unknown.exe' })],
      whitelist,
      prefixes
    )
    expect(events).toHaveLength(0)
  })

  it('whitelist=null (scan not ready): allows non-system process', async () => {
    const events = await deltaWith(
      [proc({ base: 'chrome', name: 'chrome', path: 'c:\\program files\\google\\chrome\\chrome.exe' })],
      null
    )
    expect(events).toHaveLength(1)
  })
})
