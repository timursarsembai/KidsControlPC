import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadPairing, runPairingFlow } from './pairing.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import * as firestore from 'firebase/firestore'

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((file, args, cb) => {
    // We will dynamically override this per test
    cb(null, { stdout: '', stderr: '' })
  })
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn()
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  return {
    getFirestore: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: class {
      constructor() {}
      static now() {
        return { toMillis: () => Date.now() }
      }
    }
  }
})

describe('pairing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadPairing should return null if file does not exist', () => {
    existsSync.mockReturnValue(false)
    expect(loadPairing()).toBeNull()
  })

  it('loadPairing should parse pairing.json if exists', () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue(JSON.stringify({ deviceId: '123' }))
    expect(loadPairing()).toEqual({ deviceId: '123' })
  })

  it('runPairingFlow should prompt and handle valid code', async () => {
    const { execFile } = await import('child_process')
    let callCount = 0
    execFile.mockImplementation((file, args, cb) => {
      if (callCount === 0) {
        callCount++
        cb(null, { stdout: '1', stderr: '' }) // language
      } else if (callCount === 1) {
        callCount++
        cb(null, { stdout: 'OK', stderr: '' }) // info message
      } else {
        callCount++
        cb(null, { stdout: 'ABCDEF', stderr: '' }) // pairing code
      }
    })

    firestore.getDoc.mockImplementation(async (ref) => {
      // Mock code finding
      if (ref === 'mocked_doc_pairingCodes_ABCDEF') {
        return {
          exists: () => true,
          data: () => ({ parentUid: 'parent123', expiresAt: Date.now() + 60000 })
        }
      }
      // Mock device existence
      return { exists: () => false }
    })
    
    // Mock doc() to return a string for easy checking
    firestore.doc.mockImplementation((db, col, id) => `mocked_doc_${col}_${id}`)

    const pairingData = await runPairingFlow()

    expect(pairingData).toBeTruthy()
    expect(pairingData.parentUid).toBe('parent123')
    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(firestore.setDoc).toHaveBeenCalledTimes(1) // saving device
  })

  it('runPairingFlow should reject expired code', async () => {
    const { execFile } = await import('child_process')
    let callCount = 0
    execFile.mockImplementation((file, args, cb) => {
      if (callCount === 0) {
        callCount++
        cb(null, { stdout: '1', stderr: '' }) // language
      } else if (callCount === 1) {
        callCount++
        cb(null, { stdout: 'OK', stderr: '' }) // info message
      } else if (callCount === 2) {
        callCount++
        cb(null, { stdout: 'EXPIRE', stderr: '' }) // expired pairing code
      } else if (callCount === 3) {
        callCount++
        cb(null, { stdout: 'OK', stderr: '' }) // error message
      } else {
        callCount++
        cb(null, { stdout: 'VALID1', stderr: '' }) // valid pairing code
      }
    })

    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref === 'mocked_doc_pairingCodes_EXPIRE') {
        return {
          exists: () => true,
          data: () => ({ parentUid: 'parent123', expiresAt: Date.now() - 60000 }) // EXPIRED
        }
      }
      if (ref === 'mocked_doc_pairingCodes_VALID1') {
        return {
          exists: () => true,
          data: () => ({ parentUid: 'parent123', expiresAt: Date.now() + 60000 }) // VALID
        }
      }
      return { exists: () => false }
    })
    
    firestore.doc.mockImplementation((db, col, id) => `mocked_doc_${col}_${id}`)

    const pairingData = await runPairingFlow()

    expect(pairingData.parentUid).toBe('parent123')
  })
})
