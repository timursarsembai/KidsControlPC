import { describe, it, expect } from 'vitest'
import {
  classifyStoragePath,
  isCountedFile,
  storageContextLabel,
} from './storagePaths.js'

const UID = 'sLS142aqG1g6ikIUZvxgPs69GdD2'
const CHAT = 'IF4St2eme34Ma58aJk38'
const DEVICE = 'DESKTOP-ABC123'

const ATTACHMENT = `users/${UID}/chats/${CHAT}/attachments/145d0e13-a7d7-tehnicheskaya.pdf`
const SCREENSHOT = `users/${UID}/devices/${DEVICE}/screenshots/kidscontrol-screenshot-2026.jpg`

describe('classifyStoragePath', () => {
  it('parses an attachment path', () => {
    expect(classifyStoragePath(ATTACHMENT)).toEqual({
      type: 'attachment',
      ownerUid: UID,
      contextId: CHAT,
      fileName: '145d0e13-a7d7-tehnicheskaya.pdf',
    })
  })

  it('parses a screenshot path', () => {
    expect(classifyStoragePath(SCREENSHOT)).toEqual({
      type: 'screenshot',
      ownerUid: UID,
      contextId: DEVICE,
      fileName: 'kidscontrol-screenshot-2026.jpg',
    })
  })

  it('handles nested filenames with slashes', () => {
    const p = `users/${UID}/chats/${CHAT}/attachments/sub/dir/file.png`
    expect(classifyStoragePath(p).fileName).toBe('sub/dir/file.png')
  })

  it('returns null for unrelated paths', () => {
    expect(classifyStoragePath(`users/${UID}/profile/data`)).toBeNull()
    expect(classifyStoragePath(`users/${UID}/chats/${CHAT}/attachments/`)).toBeNull()
    expect(classifyStoragePath('random/object.txt')).toBeNull()
  })

  it('returns null for empty/undefined input', () => {
    expect(classifyStoragePath('')).toBeNull()
    expect(classifyStoragePath(undefined)).toBeNull()
    expect(classifyStoragePath(null)).toBeNull()
  })
})

describe('isCountedFile', () => {
  it('counts attachments and screenshots', () => {
    expect(isCountedFile(ATTACHMENT)).toBe(true)
    expect(isCountedFile(SCREENSHOT)).toBe(true)
  })

  it('does not count other objects', () => {
    expect(isCountedFile(`users/${UID}/profile/avatar.png`)).toBe(false)
    expect(isCountedFile('')).toBe(false)
  })
})

describe('storageContextLabel', () => {
  it('labels and truncates a chat id', () => {
    expect(storageContextLabel(ATTACHMENT)).toBe('Чат: IF4St2em…')
  })

  it('labels and truncates a device id', () => {
    expect(storageContextLabel(SCREENSHOT)).toBe('Устройство: DESKTOP-…')
  })

  it('does not truncate short ids', () => {
    const p = `users/${UID}/chats/abc/attachments/x.pdf`
    expect(storageContextLabel(p)).toBe('Чат: abc')
  })

  it('returns a dash for unknown paths', () => {
    expect(storageContextLabel('nope')).toBe('—')
  })
})
