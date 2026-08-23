import { describe, it, expect } from 'vitest'
import * as devices from './devices.js'
import * as rules from './rules.js'
import * as alerts from './alerts.js'
import * as commands from './commands.js'
import * as profile from './profile.js'
import * as screenshots from './screenshots.js'
import * as chats from './chats.js'
import * as timestamps from './timestamps.js'
import { BACKEND, isSelfHosted } from './backend.js'
import * as firebaseRules from '../firebase/rules.repo.js'
import * as selfhostedRules from '../selfhosted/rules.repo.js'

// KIDSCONTROL_BACKEND drives this: the suite runs twice, once per backend.
describe(`data facade (${BACKEND})`, () => {
  // Importing both implementations must not throw even when the other one's
  // configuration is absent. On the self-hosted build there are no Firebase
  // keys at all, and an SDK that threw on import would take the whole panel
  // down before it rendered anything.
  it('imports both implementations without configuration', () => {
    expect(typeof devices.subscribeToDevices).toBe('function')
    expect(typeof rules.addRule).toBe('function')
    expect(typeof alerts.subscribeToAlerts).toBe('function')
    expect(typeof commands.sendDeviceCommand).toBe('function')
    expect(typeof profile.setPauseAllRules).toBe('function')
  })

  it('routes to the configured implementation', () => {
    const expected = isSelfHosted ? selfhostedRules : firebaseRules
    expect(rules.addRule).toBe(expected.addRule)
    expect(rules.subscribeToRules).toBe(expected.subscribeToRules)
  })

  it('produces a timestamp the backend can store', () => {
    const stamp = timestamps.serverTimestamp()
    if (isSelfHosted) {
      // Goes inside a free-form rule payload the server does not interpret,
      // so it has to be a value that survives JSON.
      expect(typeof stamp).toBe('string')
      expect(Number.isNaN(Date.parse(stamp))).toBe(false)
    } else {
      expect(stamp).toBeTypeOf('object')
    }
  })

  // Deferred features still get mounted by the panel. Subscribing has to be
  // harmless, or the screen that shows them takes the dashboard down with it.
  it('keeps deferred subscriptions harmless', () => {
    let screenshotList = null
    const unsubShots = screenshots.subscribeToScreenshots('u', 'd', list => { screenshotList = list })
    let chatList = null
    const unsubChats = chats.subscribeToChats('u', list => { chatList = list })

    if (isSelfHosted) {
      expect(screenshotList).toEqual([])
      expect(chatList).toEqual([])
    }
    expect(typeof unsubShots).toBe('function')
    expect(typeof unsubChats).toBe('function')
    unsubShots()
    unsubChats()
  })

  it.runIf(isSelfHosted)('refuses deferred writes out loud', async () => {
    await expect(chats.sendMessage('u', 'c', {})).rejects.toThrow(/Чат пока недоступен/)
    await expect(profile.recalcStorageUsed('u', 0)).rejects.toThrow(/Storage/)
  })
})
