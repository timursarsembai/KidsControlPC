import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadPairing, runPairingFlow } from './pairing.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

// Mock the widget UI (child_process)
vi.mock('child_process', () => ({
  execFile: vi.fn((file, args, cb) => {
    cb(null, { stdout: '', stderr: '' })
  })
}))

// Mock firebaseSync to avoid real Firebase init. pairing.js calls callCF()
// directly (raw https, not the firebase/functions SDK) and uses its resolved
// value unwrapped (no `.data` envelope).
const mockPairDeviceFn = vi.fn()
vi.mock('./network/firebaseSync.js', () => ({
  callCF: (...args) => mockPairDeviceFn(...args)
}))

describe('loadPairing', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null if file does not exist', () => {
    existsSync.mockReturnValue(false)
    expect(loadPairing()).toBeNull()
  })

  it('parses pairing.json when file exists', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(JSON.stringify({ deviceId: 'dev123', parentUid: 'parent456' }))
    expect(loadPairing()).toEqual({ deviceId: 'dev123', parentUid: 'parent456' })
  })

  it('returns null on JSON parse error', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue('invalid json{{{')
    expect(loadPairing()).toBeNull()
  })
})

describe('runPairingFlow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  async function setupUI(responses) {
    const { execFile } = await import('child_process')
    let callCount = 0
    execFile.mockImplementation((file, args, cb) => {
      const resp = responses[callCount] ?? ''
      callCount++
      cb(null, { stdout: resp, stderr: '' })
    })
  }

  it('pairs successfully with valid code', async () => {
    await setupUI(['1', 'OK', 'ABCDEF', 'OK'])  // lang, info, code, success
    mockPairDeviceFn.mockResolvedValue({
      parentUid: 'parent123',
      deviceId: 'device-uuid',
      screenshotUploadToken: 'server-minted-token'
    })

    const result = await runPairingFlow()

    expect(result.parentUid).toBe('parent123')
    expect(result.deviceId).toBe('device-uuid')
    // Persisted so initFirebaseSync can authenticate as agent_<deviceId>.
    expect(result.screenshotUploadToken).toBe('server-minted-token')
    // No anonymous session is created any more, so nothing shadows that identity.
    expect(result.agentUid).toBeUndefined()
    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(mockPairDeviceFn).toHaveBeenCalledWith('pairDevice', expect.objectContaining({ code: 'ABCDEF' }))
  })

  it('retries on CF error and succeeds with second code', async () => {
    await setupUI(['1', 'OK', 'BADCOD', 'OK', 'VALID1', 'OK'])
    mockPairDeviceFn
      .mockRejectedValueOnce(Object.assign(new Error('not-found'), { code: 'functions/not-found' }))
      .mockResolvedValueOnce({ parentUid: 'parentXYZ', deviceId: 'dev-456' })

    const result = await runPairingFlow()

    expect(result.parentUid).toBe('parentXYZ')
    expect(mockPairDeviceFn).toHaveBeenCalledTimes(2)
  })

  it('rejects codes shorter than 6 characters without calling CF', async () => {
    await setupUI(['1', 'OK', 'ABC', 'OK', 'ABCDEF', 'OK'])
    mockPairDeviceFn.mockResolvedValue({ parentUid: 'p', deviceId: 'd' })

    await runPairingFlow()

    // First call was 'ABC' (3 chars) — should not call CF, then 'ABCDEF' succeeds
    expect(mockPairDeviceFn).toHaveBeenCalledTimes(1)
  })

  it('throws after 3 failed attempts', async () => {
    await setupUI(['1', 'OK', 'FAIL1', 'OK', 'FAIL2', 'OK', 'FAIL3', 'OK'])
    mockPairDeviceFn.mockRejectedValue(Object.assign(new Error('not-found'), { code: 'functions/not-found' }))

    await expect(runPairingFlow()).rejects.toThrow(/attempts/)
  })

  it('throws on cancellation', async () => {
    await setupUI(['1', 'OK', 'CANCEL'])
    await expect(runPairingFlow()).rejects.toThrow(/cancelled/)
  })
})
