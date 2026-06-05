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

    on(event, cb) {
      this.handlers[event] = cb
      return this
    }

    connect(path, cb) {
      if (mockState.socketConnectSucceeds) {
        if (cb) cb()
        this.handlers.connect?.()
      } else {
        this.handlers.error?.(new Error('socket down'))
      }
      return this
    }

    write(data, cb) {
      mockState.lastSocketPayload = data
      if (cb) cb()
    }

    destroy() {}
    end() {}
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

      on(event, cb) {
        this.handlers[event] = cb
        return this
      }

      connect(path, cb) {
        if (mockState.socketConnectSucceeds) {
          if (cb) cb()
          this.handlers.connect?.()
        } else {
          this.handlers.error?.(new Error('socket down'))
        }
        return this
      }

      write(data, cb) {
        mockState.lastSocketPayload = data
        if (cb) cb()
      }

      destroy() {}
    end() {}
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
    const now = new Date('2026-05-31T12:05:00')
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
          timeFrom: '12:00',
          color: '#ffffff'
        }
      }
    ]

    await processReminders(rules)

    expect(exec).not.toHaveBeenCalled()
    expect(mockState.lastSocketPayload).toContain('"command":"remind"')
    expect(mockState.lastSocketPayload).toContain('"reminderId":"rule1"')
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
    const now = new Date('2026-05-31T12:05:00')
    vi.setSystemTime(now)
    mockState.socketConnectSucceeds = false

    const rules = [
      {
        id: 'rule3',
        type: 'reminder',
        status: 'active',
        message: 'Read a book',
        voiceLoop: true,
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
    expect(exec.mock.calls[0][0]).toContain('"0"')
  })

  it('should not replay old reminders long after their scheduled time', async () => {
    const now = new Date('2026-05-31T13:30:00')
    vi.setSystemTime(now)

    const rules = [
      {
        id: 'rule4',
        type: 'reminder',
        status: 'active',
        message: 'Old reminder',
        mode: 'schedule',
        schedule: {
          weekdays: [now.getDay() === 0 ? 6 : now.getDay() - 1],
          timeFrom: '12:00'
        }
      }
    ]

    await processReminders(rules)

    expect(exec).not.toHaveBeenCalled()
    expect(mockState.lastSocketPayload).toBe(null)
  })
})
