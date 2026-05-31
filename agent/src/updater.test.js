import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkAndUpdateSilently } from './updater.js'
import { get } from 'https'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'

vi.mock('https', () => ({
  default: {
    get: vi.fn((url, options, cb) => {
      // Mocking fetchJson response
      if (url.includes('api.github.com')) {
        const res = {
          statusCode: 200,
          on: vi.fn(function(event, handler) {
            if (event === 'data') handler(Buffer.from(JSON.stringify({
              tag_name: 'v9.9.9', // high version to force update in non-forced test
              assets: [{ name: 'KidsControlAgent_Setup.exe', browser_download_url: 'http://fake.url/setup.exe' }]
            })))
            if (event === 'end') handler()
            return this
          })
        }
        cb(res)
      } else {
        // Mocking file download
        const res = {
          statusCode: 200,
          pipe: vi.fn(),
          on: vi.fn(function(event, handler) {
            if (event === 'end') handler()
            return this
          })
        }
        cb(res)
      }
      return { on: vi.fn() }
    })
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  default: {
    spawn: vi.fn(() => ({ unref: vi.fn() }))
  }
}))

vi.mock('fs', () => ({
  default: {
    createWriteStream: vi.fn(() => ({
      on: vi.fn((event, handler) => {
        if (event === 'finish') handler()
      }),
      close: vi.fn(cb => cb && cb())
    }))
  }
}))

describe('updater', () => {
  let exitMock

  beforeEach(() => {
    vi.clearAllMocks()
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {})
  })

  afterEach(() => {
    exitMock.mockRestore()
  })

  it('should detect new version and spawn installer', async () => {
    const logs = []
    await checkAndUpdateSilently(msg => logs.push(msg), false)

    expect(logs.some(l => l.includes('Найден релиз: v9.9.9'))).toBe(true)
    const child_process = await import('child_process')
    const spawnMock = child_process.spawn || child_process.default.spawn
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringContaining('kca_setup_v9.9.9.exe'),
      ['/S'],
      { detached: true, stdio: 'ignore' }
    )
    expect(exitMock).toHaveBeenCalledWith(0)
  })

  it('should respect force flag', async () => {
    const logs = []
    await checkAndUpdateSilently(msg => logs.push(msg), true)
    
    expect(logs.some(l => l.includes('Принудительное обновление'))).toBe(true)
    const child_process = await import('child_process')
    const spawnMock = child_process.spawn || child_process.default.spawn
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(exitMock).toHaveBeenCalledWith(0)
  })
})
