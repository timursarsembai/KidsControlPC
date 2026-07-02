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

  // ── date mode ──────────────────────────────────────────────────────────────

  const dateRule = (action = 'block', date = '2026-06-01', timeFrom = '10:00', timeTo = '12:00') => ({
    id: 'dr',
    status: 'active',
    mode: 'date',
    type: 'program',
    date: { date, timeFrom, timeTo, action },
  })

  it('date mode block: active on correct date within time range', () => {
    const rule = dateRule('block')
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 11, 0))).toEqual([rule])
  })

  it('date mode block: inactive on correct date outside time range', () => {
    const rule = dateRule('block')
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 13, 0))).toEqual([])
  })

  it('date mode block: inactive on wrong date', () => {
    const rule = dateRule('block')
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 2, 11, 0))).toEqual([])
  })

  it('date mode allow: active (blocking) on wrong date', () => {
    const rule = dateRule('allow')
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 2, 11, 0))).toEqual([rule])
  })

  it('date mode allow: inactive when date and time match (allow = unblock)', () => {
    const rule = dateRule('allow')
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 11, 0))).toEqual([])
  })

  // ── disabled profiles ──────────────────────────────────────────────────────

  it('profile_config disabled=true suppresses rules with same profileId', () => {
    const config = { id: 'cfg', type: 'profile_config', profileId: 'p1', disabled: true }
    const rule = { id: 'r1', status: 'active', mode: 'profile', type: 'program', profileId: 'p1', schedule: { action: 'block', weekdays: [0], timeFrom: '00:00', timeTo: '23:59' } }
    expect(getEffectiveRules([config, rule], {}, new Date(2026, 5, 1, 11, 0))).toEqual([])
  })

  it('profile_config disabled=false does not suppress rules', () => {
    const config = { id: 'cfg', type: 'profile_config', profileId: 'p1', disabled: false }
    const rule = { id: 'r1', status: 'active', mode: 'profile', type: 'program', profileId: 'p1', schedule: { action: 'block', weekdays: [0], timeFrom: '00:00', timeTo: '23:59' } }
    expect(getEffectiveRules([config, rule], {}, new Date(2026, 5, 1, 11, 0))).toEqual([rule])
  })

  it('disabled profile does not affect rules with a different profileId', () => {
    const config = { id: 'cfg', type: 'profile_config', profileId: 'p1', disabled: true }
    const rule = { id: 'r2', status: 'active', mode: 'profile', type: 'program', profileId: 'p2', schedule: { action: 'block', weekdays: [0], timeFrom: '00:00', timeTo: '23:59' } }
    expect(getEffectiveRules([config, rule], {}, new Date(2026, 5, 1, 11, 0))).toEqual([rule])
  })

  // ── edge cases ─────────────────────────────────────────────────────────────

  it('unknown mode returns inactive (default false)', () => {
    const rule = { id: 'x', status: 'active', mode: 'unknown_future_mode', type: 'program' }
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 10, 0))).toEqual([])
  })

  it('timer.startedAt as Firestore Timestamp object is parsed correctly', () => {
    const startedAt = { toDate: () => new Date(2026, 5, 1, 10, 0) }
    const rule = { id: 't', status: 'active', mode: 'timer', type: 'program', timer: { startedAt, duration: 30 } }
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 10, 20))).toEqual([rule])
    expect(getEffectiveRules([rule], {}, new Date(2026, 5, 1, 10, 31))).toEqual([])
  })

  it('pomodoro does not add rules during break phase', () => {
    const rules = [{ id: 'p', status: 'active', type: 'pomodoro', targets: { programs: ['Game.exe'], websites: [] } }]
    const deviceConfig = { pomodoroState: { active: true, isWorkPhase: false } }
    expect(getEffectiveRules(rules, deviceConfig, new Date(2026, 5, 1, 10, 0))).toEqual([])
  })

  it('pomodoro does not add rules when inactive', () => {
    const rules = [{ id: 'p', status: 'active', type: 'pomodoro', targets: { programs: ['Game.exe'], websites: [] } }]
    const deviceConfig = { pomodoroState: { active: false, isWorkPhase: true } }
    expect(getEffectiveRules(rules, deviceConfig, new Date(2026, 5, 1, 10, 0))).toEqual([])
  })
})
