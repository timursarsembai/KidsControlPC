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
