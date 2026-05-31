import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processReminders } from './reminder.js'
import { exec } from 'child_process'

vi.mock('child_process', () => ({
  exec: vi.fn(),
  default: {
    exec: vi.fn()
  }
}))

describe('reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should trigger reminder if time is past', async () => {
    // Set current time to 12:30 PM
    const now = new Date('2026-05-31T12:30:00')
    vi.setSystemTime(now)

    const rules = [
      {
        id: 'rule1',
        type: 'reminder',
        status: 'active',
        message: 'Do homework',
        mode: 'schedule',
        schedule: {
          weekdays: [now.getDay() === 0 ? 6 : now.getDay() - 1], // today
          timeFrom: '12:00', // 12:00 PM (already passed)
          color: '#ffffff'
        }
      }
    ]

    await processReminders(rules)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('ReminderWidget.exe'),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should not trigger if time has not arrived', async () => {
    const now = new Date('2026-05-31T10:00:00')
    vi.setSystemTime(now)

    const rules = [
      {
        id: 'rule2',
        type: 'reminder',
        status: 'active',
        message: 'Do homework',
        mode: 'schedule',
        schedule: {
          weekdays: [now.getDay() === 0 ? 6 : now.getDay() - 1],
          timeFrom: '12:00' // 12:00 PM (not passed yet)
        }
      }
    ]

    await processReminders(rules)

    expect(exec).not.toHaveBeenCalled()
  })
})
