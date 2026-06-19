import { describe, expect, it, vi } from 'vitest'
import { withOperationTimeout } from './operationTimeout.js'

describe('withOperationTimeout', () => {
  it('resolves when the operation completes before the timeout', async () => {
    await expect(withOperationTimeout(Promise.resolve('ok'), 1000, 'Timed out')).resolves.toBe('ok')
  })

  it('rejects with a coded timeout error when the operation hangs', async () => {
    vi.useFakeTimers()
    const pending = new Promise(() => {})
    const result = withOperationTimeout(pending, 1000, 'Timed out', 'test_timeout')

    const expectation = expect(result).rejects.toMatchObject({
      message: 'Timed out',
      code: 'test_timeout'
    })

    await vi.advanceTimersByTimeAsync(1000)
    await expectation
    vi.useRealTimers()
  })
})
