import { describe, expect, it } from 'vitest'
import { shouldBlockBySchedule } from './ruleTiming.js'

describe('ruleTiming', () => {
  it('supports allow profile groups with independent weekdays and ranges', () => {
    const schedule = {
      groups: [
        {
          action: 'allow',
          weekdays: [0, 1, 2, 3, 4],
          ranges: [
            { timeFrom: '10:00', timeTo: '12:00' },
            { timeFrom: '16:00', timeTo: '19:00' }
          ]
        },
        {
          action: 'allow',
          weekdays: [5, 6],
          ranges: [{ timeFrom: '07:00', timeTo: '21:00' }]
        }
      ]
    }

    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 1, 10, 30))).toBe(false)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 1, 13, 0))).toBe(true)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 6, 8, 0))).toBe(false)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 6, 22, 0))).toBe(true)
  })

  it('blocks outside a free Roblox window from 10:00 to 12:00', () => {
    const schedule = {
      groups: [
        {
          action: 'allow',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          ranges: [{ timeFrom: '10:00', timeTo: '12:00' }]
        }
      ]
    }

    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 5, 6, 30))).toBe(true)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 5, 10, 30))).toBe(false)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 5, 12, 47))).toBe(true)
  })

  it('supports block profile groups without affecting other weekdays', () => {
    const schedule = {
      groups: [
        {
          action: 'block',
          weekdays: [0, 1, 2, 3, 4],
          ranges: [
            { timeFrom: '10:00', timeTo: '12:00' },
            { timeFrom: '16:00', timeTo: '19:00' }
          ]
        }
      ]
    }

    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 1, 11, 0))).toBe(true)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 1, 14, 0))).toBe(false)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 6, 11, 0))).toBe(false)
  })

  it('supports ranges crossing midnight', () => {
    const schedule = {
      groups: [
        {
          action: 'block',
          weekdays: [0],
          ranges: [{ timeFrom: '22:00', timeTo: '02:00' }]
        }
      ]
    }

    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 1, 23, 0))).toBe(true)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 2, 1, 0))).toBe(true)
    expect(shouldBlockBySchedule(schedule, new Date(2026, 5, 2, 3, 0))).toBe(false)
  })
})
