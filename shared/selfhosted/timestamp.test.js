import { describe, it, expect } from 'vitest'
import { timestamp, withTimestamps } from './timestamp.js'

const ISO = '2026-08-24T02:56:09.104Z'
const MILLIS = Date.parse(ISO)

describe('timestamp bridge', () => {
  // This is the whole point: the panel calls `value?.toDate?.()` in two dozen
  // places, and on a plain string that yields undefined — which every call site
  // reads as "never seen". A healthy PC then shows as offline forever, which is
  // exactly what happened on the first real install.
  it('answers toDate(), the way the panel asks', () => {
    const value = timestamp(ISO)
    expect(typeof value.toDate).toBe('function')
    expect(value.toDate().getTime()).toBe(MILLIS)
  })

  it('answers toMillis() and .seconds', () => {
    const value = timestamp(ISO)
    expect(value.toMillis()).toBe(MILLIS)
    expect(value.seconds).toBe(Math.floor(MILLIS / 1000))
  })

  // Some call sites skip toDate() and build a date directly. valueOf is what
  // makes that work.
  it('works when passed straight to new Date()', () => {
    expect(new Date(timestamp(ISO)).getTime()).toBe(MILLIS)
  })

  it('compares like a date, so sorting still works', () => {
    const older = timestamp('2026-08-01T00:00:00.000Z')
    const newer = timestamp(ISO)
    expect(newer > older).toBe(true)
    expect(newer - older).toBeGreaterThan(0)
  })

  it('survives JSON as the string it came from', () => {
    expect(JSON.parse(JSON.stringify({ at: timestamp(ISO) })).at).toBe(ISO)
  })

  it('gives null for nothing, rather than a broken object', () => {
    expect(timestamp(null)).toBe(null)
    expect(timestamp(undefined)).toBe(null)
    expect(timestamp('')).toBe(null)
    // A device that has never reported carries no timestamp at all; a made-up
    // one would read as "seen at the epoch".
    expect(timestamp('не дата')).toBe(null)
  })

  it('converts only the named fields', () => {
    const row = withTimestamps(
      { id: 'd1', lastSeen: ISO, pairedAt: ISO, deviceName: 'KID-PC' },
      ['lastSeen', 'pairedAt']
    )
    expect(row.lastSeen.toDate().getTime()).toBe(MILLIS)
    expect(row.pairedAt.toDate().getTime()).toBe(MILLIS)
    expect(row.deviceName).toBe('KID-PC')
    expect(row.id).toBe('d1')
  })

  it('leaves absent fields absent', () => {
    const row = withTimestamps({ id: 'd1', lastSeen: null }, ['lastSeen', 'pairedAt'])
    expect(row.lastSeen).toBe(null)
    expect(row.pairedAt).toBe(undefined)
  })

  // The exact check the device list does.
  it('reports a device seen half a minute ago as online', () => {
    const device = withTimestamps(
      { status: 'online', lastSeen: new Date(Date.now() - 30_000).toISOString() },
      ['lastSeen']
    )
    const lastSeen = device?.lastSeen?.toDate?.()
    const isOnline = device?.status !== 'offline' && lastSeen &&
      (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000
    expect(isOnline).toBe(true)
  })
})
