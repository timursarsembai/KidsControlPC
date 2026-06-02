import { exec } from 'child_process'
import net from 'net'
import path from 'path'

const widgetExe = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'dist', 'ReminderWidget.exe')
  : path.join(process.cwd(), 'ReminderWidget.exe')

const lastTriggered = {}
const WIDGET_HOST = '127.0.0.1'
const WIDGET_PORT = 49152

function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

export async function processReminders(rules) {
  const reminderRules = rules.filter(r => r.type === 'reminder' && r.status === 'active')
  const now = new Date()
  const todayStr = now.toDateString()
  
  for (const rule of reminderRules) {
    let isTime = false
    let hFrom, mFrom
    
    if (rule.mode === 'date' && rule.date) {
      if (now.toDateString() === new Date(rule.date.date).toDateString()) {
        [hFrom, mFrom] = rule.date.timeFrom.split(':').map(Number)
        isTime = true
      }
    } else if (rule.mode === 'schedule' && rule.schedule) {
      const dayOfWeek = now.getDay()
      const mappedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      if (rule.schedule.weekdays.includes(mappedDay)) {
        [hFrom, mFrom] = rule.schedule.timeFrom.split(':').map(Number)
        isTime = true
      }
    } else if (rule.mode === 'monthly_date' && rule.monthly_date) {
      if (now.getDate() === rule.monthly_date.day) {
        [hFrom, mFrom] = rule.monthly_date.timeFrom.split(':').map(Number)
        isTime = true
      }
    }
    
    if (isTime) {
      const cur = now.getHours() * 60 + now.getMinutes()
      const from = hFrom * 60 + mFrom
      
      // If the current time is past the trigger time
      if (cur >= from) {
        const lastRunStr = lastTriggered[rule.id]
        // If we haven't triggered it TODAY
        if (lastRunStr !== todayStr) {
          lastTriggered[rule.id] = todayStr
          log(`🔔 Triggering reminder: ${rule.message}`)
          await triggerReminder(rule)
        }
      }
    }
  }
}

function sendReminderToWidget(rule) {
  const msgBase64 = Buffer.from(rule.message || '', 'utf8').toString('base64')
  const loopArg = rule.voiceLoop ? '1' : '0'
  const payload = `reminder|${rule.id}|${msgBase64}|${loopArg}`

  return new Promise((resolve) => {
    const client = new net.Socket()
    let done = false

    const finish = (ok) => {
      if (done) return
      done = true
      try { client.destroy() } catch {}
      resolve(ok)
    }

    client.setTimeout(1500)
    client.once('connect', () => {
      try {
        client.write(payload)
        finish(true)
      } catch {
        finish(false)
      }
    })
    client.once('timeout', () => finish(false))
    client.once('error', () => finish(false))

    try {
      client.connect(WIDGET_PORT, WIDGET_HOST)
    } catch {
      finish(false)
    }
  })
}

async function triggerReminder(rule) {
  const msgBase64 = Buffer.from(rule.message || '').toString('base64')

  if (rule.systemNotification) {
    try {
      exec(`powershell -Command "[console]::beep(1000,300); [console]::beep(1500,300); [console]::beep(1000,300); [console]::beep(1500,300)"`, { windowsHide: true })
    } catch (e) {
      log(`⚠️ Notification error: ${e.message}`)
    }
  }

  // Prefer TimerWidget because it normally runs in the interactive user session.
  // Keep fallback non-looping to avoid endless speech from an invisible service session.
  const sent = await sendReminderToWidget(rule)
  if (!sent) {
    exec(`"${widgetExe}" "${rule.id}" "${msgBase64}" "0"`, { windowsHide: false }, (err) => {
      if (err) log(`⚠️ Error launching ReminderWidget: ${err.message}`)
    })
  }
}
