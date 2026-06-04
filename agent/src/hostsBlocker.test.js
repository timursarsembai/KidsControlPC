import { describe, expect, it } from 'vitest'
import { isProtectedDomain } from './hostsBlocker.js'

describe('hostsBlocker self-protection', () => {
  it('should protect agent sync and update domains from hosts blocking', () => {
    expect(isProtectedDomain('firestore.googleapis.com')).toBe(true)
    expect(isProtectedDomain('https://api.github.com/repos/test/release')).toBe(true)
    expect(isProtectedDomain('example.com')).toBe(false)
  })
})
