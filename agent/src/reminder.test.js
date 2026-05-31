import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processReminders } from './reminder.js'
import { exec } from 'child_process'

const mockState = vi.hoisted(() => ({
  socketConnectSucceeds: true,
  lastSocketPayload: null
}))

vi.mock('child_process', () => ({
  exec: vi.fn(),
  default: {
    exec: vi.fn()
  }
}))

vi.mock('net', () => ({
  Socket: class MockSocket {
    constructor() {
      this.handlers = {}
    }

    setTimeout() {}

    once(event, cb) {
      this.handlers[event] = cb
      return this
    }

    connect() {
      if (mockState.socketConnectSucceeds) {
        this.handlers.connect?.()
      } else {
        this.handlers.error?.(new Error('socket down'))
      }
      return this
    }

    write(data) {
      mockState.lastSocketPayload = data
    }

    destroy() {}
  },
  default: {
    Socket: class MockSocket {
      constructor() {
        this.handlers = {}
      }

      setTimeout() {}

      once(event, cb) {
        this.handlers[event] = cb
        return this
      }

      connect() {
        if (mockState.socketConnectSucceeds) {
          this.handlers.connect?.()
        } else {
          this.handlers.error?.(new Error('socket down'))
        }
        return this
      }

      write(data) {
        mockState.lastSocketPayload = data
      }

      destroy() {}
    }
  }
}))

describe('reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockState.socketConnectSucceeds = true
    mockState.lastSocketPayload = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should send reminder to TimerWidget if time is past', async () => {
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

    expect(exec).not.toHaveBeenCalled()
    expect(mockState.lastSocketPayload).toContain('reminder|rule1|')
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
    expect(mockState.lastSocketPayload).toBe(null)
  })

  it('should fallback to ReminderWidget.exe if TimerWidget socket is unavailable', async () => {
    const now = new Date('2026-05-31T12:30:00')
    vi.setSystemTime(now)
    mockState.socketConnectSucceeds = false

    const rules = [
      {
        id: 'rule3',
        type: 'reminder',
        status: 'active',
        message: 'Read a book',
        mode: 'schedule',
        schedule: {
          weekdays: [now.getDay() === 0 ? 6 : now.getDay() - 1],
          timeFrom: '12:00'
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
})
