import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enforceProcessRules } from './processEnforcer.js'
import { exec } from 'child_process'

// Mock child_process.exec
vi.mock('child_process', () => {
  return {
    exec: vi.fn((cmd, options, cb) => {
      if (typeof options === 'function') cb = options
      // Simulate success
      cb(null, 'SUCCESS', '')
    }),
    default: {
      exec: vi.fn((cmd, options, cb) => {
        if (typeof options === 'function') cb = options
        cb(null, 'SUCCESS', '')
      })
    }
  }
})

describe('processEnforcer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should kill matching processes', async () => {
    const rules = [
      {
        type: 'program',
        status: 'active',
        program: {
          executablePath: 'C:\\Program Files\\TestApp\\app.exe',
          name: 'Test App'
        }
      }
    ]
    const processes = [
      { pid: 1234, path: 'c:\\program files\\testapp\\app.exe', name: 'Test App', base: 'app' },
      { pid: 5678, path: 'c:\\windows\\system32\\notepad.exe', name: 'Notepad', base: 'notepad' }
    ]

    const killed = await enforceProcessRules(rules, processes)
    
    expect(killed).toHaveLength(1)
    expect(killed[0]).toBe('Test App')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith(
      'taskkill /F /PID 1234',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should not kill non-matching processes', async () => {
    const rules = [
      {
        type: 'program',
        status: 'active',
        program: {
          executablePath: 'C:\\Program Files\\OtherApp\\other.exe',
          name: 'Other App'
        }
      }
    ]
    const processes = [
      { pid: 1234, path: 'c:\\program files\\testapp\\app.exe', name: 'Test App', base: 'app' }
    ]

    const killed = await enforceProcessRules(rules, processes)
    
    expect(killed).toHaveLength(0)
    expect(exec).not.toHaveBeenCalled()
  })
})
