import { describe, it, expect } from 'vitest'
import { normalizeDomain, isSystemDomain } from './dnsTracker.js'

describe('normalizeDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeDomain('  Example.COM  ')).toBe('example.com')
  })

  it('strips trailing dot', () => {
    expect(normalizeDomain('youtube.com.')).toBe('youtube.com')
  })

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.youtube.com')).toBe('youtube.com')
  })

  it('does not strip non-www subdomains', () => {
    expect(normalizeDomain('sub.youtube.com')).toBe('sub.youtube.com')
  })

  it('returns null for IPv4 addresses', () => {
    expect(normalizeDomain('192.168.1.1')).toBeNull()
    expect(normalizeDomain('8.8.8.8')).toBeNull()
  })

  it('returns null for IPv6 addresses', () => {
    expect(normalizeDomain('2001:db8::1')).toBeNull()
    expect(normalizeDomain('::1')).toBeNull()
  })

  it('returns null for .local / .internal / .lan domains', () => {
    expect(normalizeDomain('mypc.local')).toBeNull()
    expect(normalizeDomain('server.internal')).toBeNull()
    expect(normalizeDomain('nas.lan')).toBeNull()
  })

  it('returns null for single-label names (no dot)', () => {
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('wpad')).toBeNull()
  })

  it('returns null for empty / null / undefined input', () => {
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain(undefined)).toBeNull()
  })

  it('accepts minimal valid domain', () => {
    expect(normalizeDomain('a.b')).toBe('a.b')
  })
})

describe('isSystemDomain', () => {
  it('matches exact system domains', () => {
    expect(isSystemDomain('localhost')).toBe(true)
    expect(isSystemDomain('wpad')).toBe(true)
    expect(isSystemDomain('isatap')).toBe(true)
  })

  it('matches system suffix domains', () => {
    expect(isSystemDomain('microsoft.com')).toBe(true)
    expect(isSystemDomain('update.microsoft.com')).toBe(true)
    expect(isSystemDomain('googleapis.com')).toBe(true)
    expect(isSystemDomain('fonts.googleapis.com')).toBe(true)
    expect(isSystemDomain('cloudfront.net')).toBe(true)
    expect(isSystemDomain('abc.cloudfront.net')).toBe(true)
  })

  it('does not match user-facing domains', () => {
    expect(isSystemDomain('youtube.com')).toBe(false)
    expect(isSystemDomain('roblox.com')).toBe(false)
    expect(isSystemDomain('tiktok.com')).toBe(false)
  })

  it('does not confuse domain name containing suffix substring', () => {
    expect(isSystemDomain('notmicrosoft.com')).toBe(false)
    expect(isSystemDomain('evil-microsoft.com')).toBe(false)
  })

  it('google.com is not a system domain (only googleapis.com is)', () => {
    expect(isSystemDomain('google.com')).toBe(false)
  })
})
