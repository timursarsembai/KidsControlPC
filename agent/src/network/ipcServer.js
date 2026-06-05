import net from 'net'
import { eventBus, EVENTS } from '../core/eventBus.js'

function log(msg) {
  console.log(`[IPC Server] ${msg}`)
}

export function startIpcServer() {
  const PIPE_NAME = '\\\\.\\pipe\\KidsControlAgentPipe'

  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString()
      const parts = buffer.split('\n')
      buffer = parts.pop()

      for (const part of parts) {
        if (!part.trim()) continue
        try {
          const payload = JSON.parse(part)
          handleIpcMessage(payload)
        } catch (err) {
          log(`⚠️ Failed to parse IPC message: ${err.message}`)
        }
      }
    })

    socket.on('error', (err) => {
      // Pipe client disconnected or error
    })
  })

  server.on('error', (err) => {
    log(`⚠️ IPC Server error: ${err.message}`)
  })

  server.listen(PIPE_NAME, () => {
    log('✅ IPC Server listening on ' + PIPE_NAME)
  })

  return server
}

function handleIpcMessage(payload) {
  if (payload.event === 'unlock_pin') {
    log('🔓 Widget unlocked by PIN')
    eventBus.emit(EVENTS.UNLOCK_REQUESTED)
  } else if (payload.event === 'reminder_dismissed') {
    log(`🔔 Reminder dismissed: ${payload.reminderId}`)
    // Might want to do something with this eventually, currently it just logged
  } else {
    log(`⚠️ Unknown IPC event: ${payload.event}`)
  }
}
