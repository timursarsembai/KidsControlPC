import { exec } from 'child_process'
import path from 'path'

const widgetExe = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'dist', 'ReminderWidget.exe')
  : path.join(process.cwd(), 'ReminderWidget.exe')

const lastTriggered = {}

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
          triggerReminder(rule)
        }
      }
    }
  }
}

function triggerReminder(rule) {
  const msgBase64 = Buffer.from(rule.message || '').toString('base64')
  const loopArg = rule.voiceLoop ? '1' : '0'

  if (rule.systemNotification) {
    try {
      exec(`powershell -Command "[console]::beep(1000,300); [console]::beep(1500,300); [console]::beep(1000,300); [console]::beep(1500,300)"`, { windowsHide: true })
    } catch (e) {
      log(`⚠️ Notification error: ${e.message}`)
    }
  }

  // Always show ReminderWidget (which also plays looping TTS if enabled)
  exec(`"${widgetExe}" "${rule.id}" "${msgBase64}" "${loopArg}"`, { windowsHide: false }, (err) => {
    if (err) log(`⚠️ Error launching ReminderWidget: ${err.message}`)
  })
}
