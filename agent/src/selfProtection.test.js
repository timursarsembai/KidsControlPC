import { describe, expect, it } from 'vitest'
import { isProtectedProcess, isProtectedProgramEntry } from './selfProtection.js'

describe('selfProtection', () => {
  it('should protect agent and widget processes', () => {
    expect(isProtectedProcess({
      pid: 1234,
      name: 'agent',
      base: 'agent',
      path: 'c:\\program files\\kidscontrolagent\\agent.exe'
    })).toBe(true)

    expect(isProtectedProcess({
      pid: 1235,
      name: 'timerwidget',
      base: 'timerwidget',
      path: 'c:\\program files\\kidscontrolagent\\timerwidget.exe'
    })).toBe(true)
  })

  it('should protect installed app entries for the child agent', () => {
    expect(isProtectedProgramEntry({
      DisplayName: 'KidsControlPC Agent',
      InstallLocation: 'C:\\Program Files\\KidsControlAgent'
    })).toBe(true)

    expect(isProtectedProgramEntry({
      DisplayName: 'Regular App',
      InstallLocation: 'C:\\Program Files\\RegularApp'
    })).toBe(false)
  })
})
