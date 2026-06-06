import { execAsync } from '../core/utils.js'

export async function executePowerAction(action, log = console.log) {
  if (action === 'shutdown') {
    log('Shutting down...')
    await execAsync('shutdown /s /t 0')
  } else if (action === 'restart') {
    log('Restarting...')
    await execAsync('shutdown /r /t 0')
  } else if (action === 'sleep') {
    log('Sleeping...')
    await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
  } else if (action === 'hibernate') {
    log('Hibernating...')
    await execAsync('rundll32.exe powrprof.dll,SetSuspendState 1,1,0')
  } else {
    throw new Error(`Unknown power action: ${action}`)
  }
}
