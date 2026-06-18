import { shouldBlockBySchedule } from '../ruleTiming.js'

function isTimerRuleEffective(rule, now) {
  if (!rule.timer?.startedAt || !rule.timer?.duration) return false
  const startedAt = rule.timer.startedAt?.toDate?.() || new Date(rule.timer.startedAt)
  const durationMs = Number(rule.timer.duration) * 60 * 1000
  return (now - startedAt) < durationMs
}

function isDateRuleEffective(rule, now) {
  if (!rule.date?.date || !rule.date?.timeFrom || !rule.date?.timeTo) return false
  const action = rule.date.action || 'block'
  const ruleDate = new Date(rule.date.date)
  const isRightDay = now.toDateString() === ruleDate.toDateString()
  const [hFrom, mFrom] = rule.date.timeFrom.split(':').map(Number)
  const [hTo, mTo] = rule.date.timeTo.split(':').map(Number)
  const cur = now.getHours() * 60 + now.getMinutes()
  const isWithinTime = cur >= (hFrom * 60 + mFrom) && cur <= (hTo * 60 + mTo)

  return action === 'block'
    ? isRightDay && isWithinTime
    : !isRightDay || !isWithinTime
}

function isRuleEffective(rule, now) {
  if (rule.status !== 'active') return false
  if (rule.type === 'profile_config') return false

  switch (rule.mode) {
    case 'permanent':
      return true
    case 'timer':
      return isTimerRuleEffective(rule, now)
    case 'schedule':
    case 'profile':
      return !!rule.schedule && shouldBlockBySchedule(rule.schedule, now)
    case 'date':
      return isDateRuleEffective(rule, now)
    default:
      return false
  }
}

function getPomodoroRules(activeRules, deviceConfig) {
  if (!deviceConfig?.pomodoroState?.active || !deviceConfig?.pomodoroState?.isWorkPhase) {
    return []
  }

  const pRule = activeRules.find(r => r.type === 'pomodoro' && r.status === 'active')
  if (!pRule) return []

  const programRules = (pRule.targets?.programs || []).map(pName => ({
    type: 'program',
    program: { name: pName }
  }))
  const webRules = (pRule.targets?.websites || []).map(wUrl => ({
    type: 'web',
    web: { resolvedPattern: wUrl }
  }))

  return [...programRules, ...webRules]
}

export function getEffectiveRules(activeRules, deviceConfig, now = new Date()) {
  return [
    ...activeRules.filter(rule => isRuleEffective(rule, now)),
    ...getPomodoroRules(activeRules, deviceConfig)
  ]
}

export function logProfileRuleDebug(activeRules, now, log) {
  const profileRules = activeRules.filter(r => r.mode === 'profile')
  if (profileRules.length === 0) return

  log(`📊 Profile rules count: ${profileRules.length}`)
  for (const r of profileRules) {
    const hasSchedule = !!r.schedule
    const scheduleAction = r.schedule?.action || 'N/A'
    const groups = r.schedule?.groups?.length || 0
    const shouldBlock = hasSchedule ? shouldBlockBySchedule(r.schedule, now) : 'no schedule'
    log(`  → id=${r.id} type=${r.type} mode=${r.mode} status=${r.status} hasSchedule=${hasSchedule} scheduleAction=${scheduleAction} groups=${groups} shouldBlock=${shouldBlock} program=${r.program?.name || 'N/A'}`)
  }
}

export function logEffectiveProgramRules(effectiveRules, log) {
  const effectivePrograms = effectiveRules.filter(r => r.type === 'program')
  if (effectivePrograms.length === 0) return

  log(`🔒 Effective program rules to enforce: ${effectivePrograms.length}`)
  for (const r of effectivePrograms) {
    log(`  → ${r.program?.name} (mode=${r.mode}, schedule_action=${r.schedule?.action || 'N/A'})`)
  }
}
