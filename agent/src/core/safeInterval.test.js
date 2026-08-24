import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeInterval } from './safeInterval.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const noop = () => {}

describe('периодическая задача агента', () => {
  it('не запускает следующий проход, пока идёт предыдущий', async () => {
    let running = 0
    let peak = 0
    const timer = safeInterval('проверка', 1000, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 3500))
      running--
    }, { log: noop })

    await vi.advanceTimersByTimeAsync(10_000)
    clearInterval(timer)

    // Без защиты к этому моменту накопилось бы несколько одновременных
    // проходов — ровно то, что превращает нехватку памяти в лавину.
    expect(peak).toBe(1)
  })

  it('брошенная ошибка не убивает цикл', async () => {
    let calls = 0
    const timer = safeInterval('проверка', 1000, async () => {
      calls++
      throw new Error('список процессов недоступен')
    }, { log: noop })

    await vi.advanceTimersByTimeAsync(5000)
    clearInterval(timer)

    expect(calls).toBe(5)
  })

  it('сообщает об ошибке, а не молчит', async () => {
    const log = vi.fn()
    const timer = safeInterval('проверка', 1000, async () => {
      throw new Error('нет доступа к экрану')
    }, { log })

    await vi.advanceTimersByTimeAsync(1000)
    clearInterval(timer)

    expect(log).toHaveBeenCalledWith(expect.stringContaining('нет доступа к экрану'))
  })

  // Иначе зависший навсегда проход означал бы, что правила больше никогда не
  // применяются, — а это ребёнок без присмотра при живой на вид службе.
  it('пускает новый проход, если предыдущий завис дольше положенного', async () => {
    let started = 0
    const timer = safeInterval('проверка', 1000, async () => {
      started++
      await new Promise(() => {}) // никогда не завершится
    }, { maxRunMs: 5000, log: noop })

    await vi.advanceTimersByTimeAsync(4000)
    expect(started).toBe(1)

    await vi.advanceTimersByTimeAsync(3000)
    clearInterval(timer)
    expect(started).toBe(2)
  })

  it('предупреждает о затянувшихся проходах, но не на каждом пропуске', async () => {
    const log = vi.fn()
    const timer = safeInterval('проверка', 1000, async () => {
      await new Promise(r => setTimeout(r, 4500))
    }, { log })

    await vi.advanceTimersByTimeAsync(4000)
    clearInterval(timer)

    // Один-два пропуска на загруженной машине — обычное дело, шуметь не о чем.
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('пропущено подряд: 3')
  })

  it('работает и с обычной, не асинхронной задачей', async () => {
    let calls = 0
    const timer = safeInterval('проверка', 1000, () => { calls++ }, { log: noop })
    await vi.advanceTimersByTimeAsync(3000)
    clearInterval(timer)
    expect(calls).toBe(3)
  })
})
