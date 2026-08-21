import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { tmpdir } from 'os'
import { sendToWidget } from './services/widgetManager.js'

const widgetExe = process.env.NODE_ENV === 'development'
  ? path.join(process.cwd(), 'dist', 'ReminderWidget.exe')
  : path.join(process.cwd(), 'ReminderWidget.exe')

const lastTriggered = {}
const REMINDER_GRACE_MINUTES = 10
const reminderStateFile = process.env.NODE_ENV === 'test'
  ? path.join(tmpdir(), `kidscontrol-reminder-state-${process.pid}.json`)
  : path.join(process.cwd(), 'reminder-state.json')

function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

function loadReminderState() {
  try {
    return JSON.parse(fs.readFileSync(reminderStateFile, 'utf8'))
  } catch {
    return {}
  }
}

function saveReminderState(state) {
  try {
    fs.writeFileSync(reminderStateFile, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    log(`Reminder state write error: ${err.message}`)
  }
}

function getDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function getTriggerKey(rule, date, timeFrom) {
  return `${getDayKey(date)}|${rule.mode}|${timeFrom}|${rule.message || ''}`
}

function getReminderTime(rule, now) {
  if (rule.mode === 'date' && rule.date) {
    if (now.toDateString() !== new Date(rule.date.date).toDateString()) return null
    return rule.date.timeFrom
  }

  if (rule.mode === 'schedule' && rule.schedule) {
    const dayOfWeek = now.getDay()
    const mappedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    if (!rule.schedule.weekdays.includes(mappedDay)) return null
    return rule.schedule.timeFrom
  }

  if (rule.mode === 'monthly_date' && rule.monthly_date) {
    if (now.getDate() !== rule.monthly_date.day) return null
    return rule.monthly_date.timeFrom
  }

  return null
}

export async function processReminders(rules) {
  const reminderRules = rules.filter(r => r.type === 'reminder' && r.status === 'active')
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const reminderState = loadReminderState()

  for (const rule of reminderRules) {
    const timeFrom = getReminderTime(rule, now)
    if (!timeFrom) continue

    const [hFrom, mFrom] = timeFrom.split(':').map(Number)
    const from = hFrom * 60 + mFrom
    const minutesSinceTrigger = cur - from

    if (minutesSinceTrigger < 0 || minutesSinceTrigger > REMINDER_GRACE_MINUTES) continue

    const triggerKey = getTriggerKey(rule, now, timeFrom)
    if (lastTriggered[rule.id] === triggerKey || reminderState[rule.id] === triggerKey) continue

    lastTriggered[rule.id] = triggerKey
    reminderState[rule.id] = triggerKey
    saveReminderState(reminderState)

    log(`Triggering reminder: ${rule.message}`)
    await triggerReminder(rule)
  }
}

async function sendReminderToWidget(rule) {
  return await sendToWidget({
    command: 'remind',
    reminderId: rule.id,
    message: rule.message || '',
    voiceLoop: rule.voiceLoop ? true : false
  }, { ensureStarted: false })
}

async function triggerReminder(rule) {
  const msgBase64 = Buffer.from(rule.message || '').toString('base64')

  if (rule.systemNotification) {
    try {
      exec(`powershell -Command "[console]::beep(1000,300); [console]::beep(1500,300); [console]::beep(1000,300); [console]::beep(1500,300)"`, { windowsHide: true })
    } catch (e) {
      log(`Notification error: ${e.message}`)
    }
  }

  const sent = await sendReminderToWidget(rule)
  if (!sent) {
    exec(`"${widgetExe}" "${rule.id}" "${msgBase64}" "0"`, { windowsHide: false }, (err) => {
      if (err) log(`Error launching ReminderWidget: ${err.message}`)
    })
  }
}
