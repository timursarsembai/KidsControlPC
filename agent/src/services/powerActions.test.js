import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executePowerAction } from './powerActions.js'
import { execAsync } from '../core/utils.js'

vi.mock('../core/utils.js', () => ({
  execAsync: vi.fn()
}))

describe('powerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['shutdown', 'shutdown /s /t 0'],
    ['restart', 'shutdown /r /t 0'],
    ['sleep', 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'],
    ['hibernate', 'rundll32.exe powrprof.dll,SetSuspendState 1,1,0']
  ])('executes %s', async (action, command) => {
    const logs = []

    await executePowerAction(action, msg => logs.push(msg))

    expect(execAsync).toHaveBeenCalledWith(command)
    expect(logs.length).toBe(1)
  })

  it('rejects unknown actions', async () => {
    await expect(executePowerAction('bogus')).rejects.toThrow('Unknown power action: bogus')
    expect(execAsync).not.toHaveBeenCalled()
  })
})
