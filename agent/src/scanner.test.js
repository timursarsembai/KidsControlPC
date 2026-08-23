import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getInstalledPrograms, getRunningProcesses } from './scanner.js'
import { exec } from 'child_process'
import { promisify } from 'util'

// Mock child_process.exec
vi.mock('child_process', async (importOriginal) => {
  const util = await import('util')
  const execMock = vi.fn((cmd, options, cb) => {
    if (typeof options === 'function') cb = options
    cb(null, '[]', '')
  })
  execMock[util.promisify.custom] = async (cmd, options) => {
    if (global.__execMockError) throw new Error(global.__execMockError)
    if (global.__execMockOutput) {
      return { stdout: global.__execMockOutput, stderr: '' }
    }
    return { stdout: '[]', stderr: '' }
  }
  return {
    exec: execMock,
    default: {
      exec: execMock
    }
  }
})

describe('scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should parse installed programs', async () => {
    // Override the mock temporarily for this test
    global.__execMockOutput = JSON.stringify([
      { DisplayName: 'Test Program', DisplayIcon: 'C:\\test.exe', Publisher: 'Tester' }
    ])

    const programs = await getInstalledPrograms()
    expect(programs).toHaveLength(1)
    expect(programs[0].name).toBe('Test Program')
    expect(programs[0].path).toBe('C:\\test.exe')
  })

  it('should parse running processes', async () => {
    global.__execMockOutput = JSON.stringify([
      { Id: 1000, Path: 'C:\\proc.exe', Name: 'proc.exe' }
    ])

    const procs = await getRunningProcesses()
    expect(procs).toHaveLength(1)
    expect(procs[0].pid).toBe(1000)
    expect(procs[0].path).toBe('c:\\proc.exe') // lowercase path
    expect(procs[0].name).toBe('proc.exe')
    expect(procs[0].base).toBe('proc')
  })
})

// On a machine that has exhausted its memory, spawning powershell.exe is the first
// thing to fail, and retrying every 5 seconds only adds to the pressure. After a
// failure the scanner must stop spawning until its cooldown expires.
describe('PowerShell backoff', () => {
  beforeEach(() => {
    global.__execMockOutput = undefined
    global.__execMockError = undefined
  })

  it('stops invoking PowerShell during the cooldown that follows a failure', async () => {
    global.__execMockError = 'Command failed: powershell.exe'
    expect(await getRunningProcesses()).toEqual([])

    // Make the shell succeed with real data. A call that still reached it would return
    // that process; returning [] proves the cooldown short-circuited before spawning.
    global.__execMockError = undefined
    global.__execMockOutput = JSON.stringify([
      { Name: 'notepad', Id: 1, Path: 'C:\\Windows\\System32\\notepad.exe', MainWindowHandle: 1, MainWindowTitle: 'Untitled' }
    ])
    expect(await getRunningProcesses()).toEqual([])

    // Callers must still degrade to "no data" rather than throwing, so enforcement
    // keeps running from the cached rules.
    expect(await getInstalledPrograms()).toEqual([])
  })
})
