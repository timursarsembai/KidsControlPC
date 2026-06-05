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
      { pid: 1234, path: 'c:\\program files\\testapp\\app.exe', name: 'Test App', base: 'app', hasWindow: true },
      { pid: 5678, path: 'c:\\windows\\system32\\notepad.exe', name: 'Notepad', base: 'notepad', hasWindow: true }
    ]

    const killed = await enforceProcessRules(rules, processes)
    
    expect(killed).toHaveLength(1)
    expect(killed[0]).toEqual({ name: 'Test App', interactive: true })
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
      { pid: 1234, path: 'c:\\program files\\testapp\\app.exe', name: 'Test App', base: 'app', hasWindow: true }
    ]

    const killed = await enforceProcessRules(rules, processes)
    
    expect(killed).toHaveLength(0)
    expect(exec).not.toHaveBeenCalled()
  })

  it('should kill Roblox Player after Roblox changes version folder', async () => {
    const rules = [
      {
        type: 'program',
        status: 'active',
        program: {
          executablePath: 'C:\\Users\\Child\\AppData\\Local\\Roblox\\Versions\\ver-old',
          name: 'Roblox Player for Child'
        }
      }
    ]
    const processes = [
      {
        pid: 4321,
        path: 'c:\\users\\child\\appdata\\local\\roblox\\versions\\ver-new\\robloxplayerbeta.exe',
        name: 'robloxplayerbeta',
        base: 'robloxplayerbeta',
        hasWindow: true
      }
    ]

    const killed = await enforceProcessRules(rules, processes)

    expect(killed).toHaveLength(1)
    expect(killed[0]).toEqual({ name: 'Roblox Player for Child', interactive: true })
    expect(exec).toHaveBeenCalledWith(
      'taskkill /F /PID 4321',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should never kill KidsControl agent processes', async () => {
    const rules = [
      {
        type: 'program',
        status: 'active',
        program: {
          executablePath: 'C:\\Program Files\\KidsControlAgent\\agent.exe',
          name: 'KidsControlPC Agent'
        }
      }
    ]
    const processes = [
      { pid: 1234, path: 'c:\\program files\\kidscontrolagent\\agent.exe', name: 'agent', base: 'agent', hasWindow: false },
      { pid: 5678, path: 'c:\\program files\\kidscontrolagent\\timerwidget.exe', name: 'timerwidget', base: 'timerwidget', hasWindow: true }
    ]

    const killed = await enforceProcessRules(rules, processes)

    expect(killed).toHaveLength(0)
    expect(exec).not.toHaveBeenCalled()
  })
})
