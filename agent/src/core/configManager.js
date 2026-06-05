import fs from 'fs'
import path from 'path'
import { eventBus, EVENTS } from './eventBus.js'

let deviceConfig = null
let activeRules = []

function log(msg) {
  console.log(`[ConfigManager] ${msg}`)
}

export function saveConfigCache() {
  try {
    fs.writeFileSync(path.join(process.cwd(), 'config_cache.json'), JSON.stringify({
      deviceConfig,
      activeRules
    }))
  } catch { }
}

export function loadConfigCache() {
  try {
    const p = path.join(process.cwd(), 'config_cache.json')
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (data.deviceConfig) {
        deviceConfig = data.deviceConfig
      }
      if (data.activeRules) {
        activeRules = data.activeRules
      }
      log('💾 Loaded config cache from disk for instant offline enforcement')
    }
  } catch { }
}

export function getDeviceConfig() {
  return deviceConfig
}

export function setDeviceConfig(config) {
  deviceConfig = config
  saveConfigCache()
  eventBus.emit(EVENTS.DEVICE_CONFIG_UPDATED, config)
}

export function getActiveRules() {
  return activeRules
}

export function setActiveRules(rules) {
  activeRules = rules
  saveConfigCache()
  eventBus.emit(EVENTS.RULES_UPDATED, rules)
}
