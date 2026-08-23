import { describe, it, expect } from 'vitest'
import { applyFrame, emptyState, toArray } from './channelState.js'

describe('channel state', () => {
  it('takes the collection from a snapshot', () => {
    const state = emptyState()
    const changed = applyFrame(state, {
      t: 'snap',
      data: [{ id: 'a', alias: 'ПК Айгерим' }, { id: 'b', alias: 'Ноутбук' }]
    })

    expect(changed).toBe(true)
    expect(toArray(state)).toHaveLength(2)
  })

  it('replaces the collection on a later snapshot rather than merging', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a' }, { id: 'b' }] })
    applyFrame(state, { t: 'snap', data: [{ id: 'c' }] })

    expect(toArray(state).map(x => x.id)).toEqual(['c'])
  })

  it('adds and updates rows from upserts', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a', status: 'active' }] })

    applyFrame(state, { t: 'patch', op: 'upsert', data: { id: 'b', status: 'active' } })
    applyFrame(state, { t: 'patch', op: 'upsert', data: { id: 'a', status: 'inactive' } })

    const items = toArray(state)
    expect(items).toHaveLength(2)
    expect(items.find(x => x.id === 'a').status).toBe('inactive')
  })

  it('drops rows on remove', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a' }, { id: 'b' }] })

    const changed = applyFrame(state, { t: 'patch', op: 'remove', data: { id: 'a' } })

    expect(changed).toBe(true)
    expect(toArray(state).map(x => x.id)).toEqual(['b'])
  })

  it('reports no change when removing something it does not have', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a' }] })

    expect(applyFrame(state, { t: 'patch', op: 'remove', data: { id: 'zzz' } })).toBe(false)
  })

  // A patch arriving before the first snapshot would build a collection out of
  // one row — a panel rendering that shows one device where there are four.
  it('ignores patches that arrive before the first snapshot', () => {
    const state = emptyState()

    const changed = applyFrame(state, { t: 'patch', op: 'upsert', data: { id: 'a' } })

    expect(changed).toBe(false)
    expect(toArray(state)).toHaveLength(0)
  })

  it('survives malformed frames', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a' }] })

    expect(applyFrame(state, null)).toBe(false)
    expect(applyFrame(state, 'nonsense')).toBe(false)
    expect(applyFrame(state, { t: 'patch', op: 'upsert' })).toBe(false)
    expect(applyFrame(state, { t: 'patch', op: 'unknown', data: { id: 'a' } })).toBe(false)
    expect(applyFrame(state, { t: 'snap' })).toBe(true)
  })

  it('skips snapshot rows without an id', () => {
    const state = emptyState()
    applyFrame(state, { t: 'snap', data: [{ id: 'a' }, { alias: 'без идентификатора' }] })

    expect(toArray(state)).toHaveLength(1)
  })
})
