import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadConfig() {
  vi.resetModules()
  return import('./config.js')
}

describe('agent config', () => {
  afterEach(() => {
    delete process.env.KIDSCONTROL_ENV
  })

  it('uses production Firebase by default', async () => {
    delete process.env.KIDSCONTROL_ENV

    const config = await loadConfig()

    expect(config.APP_ENV).toBe('production')
    expect(config.firebaseConfig.projectId).toBe('kidscontrolpc')
    expect(config.PAIRING_FILE.endsWith('pairing.json')).toBe(true)
  })

  it('uses staging Firebase when KIDSCONTROL_ENV is staging', async () => {
    process.env.KIDSCONTROL_ENV = 'staging'

    const config = await loadConfig()

    expect(config.APP_ENV).toBe('staging')
    expect(config.firebaseConfig.projectId).toBe('kidscontrolpc-dev')
    expect(config.PAIRING_FILE.endsWith('pairing.staging.json')).toBe(true)
  })
})
