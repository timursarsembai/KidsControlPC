import { describe, expect, it } from 'vitest'
import {
  getDayIndex,
  getScheduleGroups,
  isScheduleBlockingNow,
  isScheduleGroupActive
} from './timeHelpers.js'

describe('timeHelpers schedule helpers', () => {
  it('maps JavaScript weekdays to Monday-first indexes', () => {
    expect(getDayIndex(new Date(2026, 5, 1))).toBe(0)
    expect(getDayIndex(new Date(2026, 5, 7))).toBe(6)
  })

  it('normalizes legacy schedule shape into groups', () => {
    expect(getScheduleGroups({
      action: 'allow',
      weekdays: [0, 1],
      timeFrom: '10:00',
      timeTo: '12:00'
    })).toEqual([{
      action: 'allow',
      weekdays: [0, 1],
      ranges: [{ timeFrom: '10:00', timeTo: '12:00' }]
    }])
  })

  it('detects active groups including overnight ranges', () => {
    const group = {
      action: 'block',
      weekdays: [0],
      ranges: [{ timeFrom: '22:00', timeTo: '02:00' }]
    }

    expect(isScheduleGroupActive(group, new Date(2026, 5, 1, 23, 0))).toBe(true)
    expect(isScheduleGroupActive(group, new Date(2026, 5, 2, 1, 0))).toBe(true)
    expect(isScheduleGroupActive(group, new Date(2026, 5, 2, 3, 0))).toBe(false)
  })

  it('blocks only inside block ranges', () => {
    const schedule = {
      groups: [{
        action: 'block',
        weekdays: [0, 1, 2, 3, 4],
        ranges: [{ timeFrom: '10:00', timeTo: '12:00' }]
      }]
    }

    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 1, 11, 0))).toBe(true)
    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 1, 13, 0))).toBe(false)
    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 6, 11, 0))).toBe(false)
  })

  it('blocks outside allow ranges for selected weekdays', () => {
    const schedule = {
      groups: [{
        action: 'allow',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        ranges: [{ timeFrom: '10:00', timeTo: '12:00' }]
      }]
    }

    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 5, 9, 0))).toBe(true)
    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 5, 10, 30))).toBe(false)
    expect(isScheduleBlockingNow(schedule, new Date(2026, 5, 5, 12, 30))).toBe(true)
  })

  it('does not block empty schedules', () => {
    expect(isScheduleBlockingNow({}, new Date(2026, 5, 5, 10, 30))).toBe(false)
    expect(isScheduleBlockingNow(null, new Date(2026, 5, 5, 10, 30))).toBe(false)
  })
})
