import { describe, expect, it } from 'vitest'
import { getEffectiveRules } from './ruleEvaluator.js'

describe('ruleEvaluator', () => {
  it('returns permanent active rules', () => {
    const rules = [
      { id: 'a', status: 'active', mode: 'permanent', type: 'program' },
      { id: 'b', status: 'inactive', mode: 'permanent', type: 'program' }
    ]

    expect(getEffectiveRules(rules, {}, new Date(2026, 5, 1, 10, 0))).toEqual([rules[0]])
  })

  it('evaluates timer rules', () => {
    const startedAt = new Date(2026, 5, 1, 10, 0)
    const rules = [{
      id: 'timer',
      status: 'active',
      mode: 'timer',
      type: 'program',
      timer: { startedAt, duration: 30 }
    }]

    expect(getEffectiveRules(rules, {}, new Date(2026, 5, 1, 10, 20))).toEqual(rules)
    expect(getEffectiveRules(rules, {}, new Date(2026, 5, 1, 10, 31))).toEqual([])
  })

  it('uses shared schedule evaluation for profile and schedule modes', () => {
    const rules = [{
      id: 'schedule',
      status: 'active',
      mode: 'schedule',
      type: 'program',
      schedule: {
        action: 'block',
        weekdays: [0],
        timeFrom: '10:00',
        timeTo: '12:00'
      }
    }]

    expect(getEffectiveRules(rules, {}, new Date(2026, 5, 1, 11, 0))).toEqual(rules)
    expect(getEffectiveRules(rules, {}, new Date(2026, 5, 1, 13, 0))).toEqual([])
  })

  it('adds virtual pomodoro target rules during work phase', () => {
    const rules = [{
      id: 'pomodoro',
      status: 'active',
      type: 'pomodoro',
      targets: {
        programs: ['Game.exe'],
        websites: ['example.com']
      }
    }]
    const deviceConfig = {
      pomodoroState: {
        active: true,
        isWorkPhase: true
      }
    }

    expect(getEffectiveRules(rules, deviceConfig, new Date(2026, 5, 1, 10, 0))).toEqual([
      { type: 'program', program: { name: 'Game.exe' } },
      { type: 'web', web: { resolvedPattern: 'example.com' } }
    ])
  })
})
