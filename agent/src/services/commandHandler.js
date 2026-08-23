import { eventBus, EVENTS } from '../core/eventBus.js'
import {
  markCommandCompleted,
  markCommandFailed,
  pushRecentLogs
} from '../network/sync.js'
import { ensureWidgetLocked } from './widgetManager.js'
import { takeScreenshot } from './screenshotService.js'
import { executePowerAction } from './powerActions.js'
import { checkAndUpdateSilently } from '../updater.js'

let registered = false
let lastForceUpdateRequestMs = 0
let forceUpdateBaselineLoaded = false

export function registerCommandHandlers(log) {
  if (registered) return
  registered = true

  eventBus.on(EVENTS.COMMAND_RECEIVED, async ({ doc: cmdDoc, cmd }) => {
    log(`📥 Received command: ${cmd.action || cmd.command}`)

    if (cmd.command === 'fetch_logs') {
      try {
        await pushRecentLogs()
        await markCommandCompleted(cmdDoc)
      } catch (err) {
        await markCommandFailed(cmdDoc, err.message)
      }
      return
    }

    if (cmd.command === 'screenshot_request' || cmd.action === 'screenshot_request') {
      try {
        log('[Screenshot] Manual screenshot command accepted')
        const result = await takeScreenshot('manual')
        await markCommandCompleted(cmdDoc, result)
      } catch (err) {
        log(`[Screenshot] Manual screenshot failed: ${err.message}`)
        await markCommandFailed(cmdDoc, err.message, { code: err.code || 'screenshot_failed' })
      }
      return
    }

    try {
      const action = cmd.action || cmd.command
      if (action === 'lock') {
        await ensureWidgetLocked()
      } else if (action === 'unlock') {
        eventBus.emit(EVENTS.UNLOCK_REQUESTED)
      } else if (action === 'update_agent' || action === 'force_update') {
        await checkAndUpdateSilently(log, true)
      } else if (['shutdown', 'restart', 'sleep', 'hibernate'].includes(action)) {
        await executePowerAction(action, log)
      } else {
        throw new Error(`Unknown command action: ${action}`)
      }
      await markCommandCompleted(cmdDoc)
    } catch (err) {
      await markCommandFailed(cmdDoc, err.message)
    }
  })

  eventBus.on(EVENTS.DEVICE_CONFIG_UPDATED, (config) => {
    const requestedAtMs = Number(config?.forceUpdateRequestedAtMs || 0)

    if (!forceUpdateBaselineLoaded) {
      forceUpdateBaselineLoaded = true
      lastForceUpdateRequestMs = requestedAtMs
      return
    }

    if (!requestedAtMs || requestedAtMs <= lastForceUpdateRequestMs) return

    lastForceUpdateRequestMs = requestedAtMs
    checkAndUpdateSilently(log, true).catch(err => {
      log(`[Updater] Force update failed: ${err.message}`)
    })
  })
}
