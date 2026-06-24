export const toDayIndex = (date) => {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

export const getDayIndex = toDayIndex

const parseTimeToMinutes = (value) => {
  if (!value || typeof value !== 'string') return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

const formatTime = (secs) => {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function getScheduleGroups(schedule) {
  if (Array.isArray(schedule?.groups) && schedule.groups.length > 0) {
    return schedule.groups.map(group => ({
      ...group,
      action: group.action || schedule.action || 'block'
    }))
  }
  if (schedule?.weekdays?.length) {
    return [{
      action: schedule.action || 'block',
      weekdays: schedule.weekdays,
      ranges: Array.isArray(schedule.ranges) && schedule.ranges.length > 0
        ? schedule.ranges
        : [{ timeFrom: schedule.timeFrom, timeTo: schedule.timeTo }]
    }]
  }
  return []
}

export function isScheduleGroupActive(group, now = new Date()) {
  if (!group?.weekdays?.length) return false
  const today = toDayIndex(now)
  const previousDay = today === 0 ? 6 : today - 1
  const currentMinute = now.getHours() * 60 + now.getMinutes()
  const ranges = Array.isArray(group.ranges) && group.ranges.length > 0
    ? group.ranges
    : []

  return ranges.some((range) => {
    const from = parseTimeToMinutes(range.timeFrom)
    const rawTo = parseTimeToMinutes(range.timeTo)
    if (from === null || rawTo === null) return false

    if (from === rawTo) {
      return group.weekdays.includes(today) && currentMinute === from
    }

    const to = rawTo === 0 && from > 0 ? 1440 : rawTo

    if (from < to) {
      return group.weekdays.includes(today) &&
        currentMinute >= from &&
        currentMinute < to
    }

    return (group.weekdays.includes(today) && currentMinute >= from) ||
      (group.weekdays.includes(previousDay) && currentMinute < rawTo)
  })
}

export function isScheduleWindowActive(schedule, now = new Date()) {
  return getScheduleGroups(schedule).some(group => isScheduleGroupActive(group, now))
}

export function isScheduleBlockingNow(schedule, now = new Date()) {
  const groups = getScheduleGroups(schedule)
  if (groups.length === 0) return false
  const today = toDayIndex(now)

  if (groups.some(group => group.action === 'block' && isScheduleGroupActive(group, now))) {
    return true
  }

  const allowGroups = groups.filter(group =>
    group.action !== 'block' && group.weekdays?.includes(today)
  )
  if (allowGroups.length > 0) {
    return !allowGroups.some(group => isScheduleGroupActive(group, now))
  }

  return false
}

function evaluateSchedule(rule, now, modeLabel = 'расписанию') {
  const groups = getScheduleGroups(rule.schedule)
  if (groups.length === 0) {
    return { isBlocked: false, statusText: 'Расписание не настроено' }
  }

  if (rule.schedule?.ranges?.length || rule.schedule?.groups?.length) {
    const isBlocked = isScheduleBlockingNow(rule.schedule, now)
    return {
      isBlocked,
      statusText: isBlocked ? `Блокируется по ${modeLabel}` : `Доступно по ${modeLabel}`
    }
  }

  if (!rule.schedule?.timeFrom || !rule.schedule?.timeTo) {
    return { isBlocked: false, statusText: 'Расписание не настроено' }
  }

  const action = rule.schedule.action || 'block'
  const mappedDay = toDayIndex(now)
  const { weekdays, timeFrom, timeTo } = rule.schedule

  if (!weekdays.includes(mappedDay)) {
    return action === 'block'
      ? { isBlocked: false, statusText: 'Сегодня не блокируется' }
      : { isBlocked: true, statusText: 'Сегодня заблокировано' }
  }

  const [hFrom, mFrom] = timeFrom.split(':').map(Number)
  const [hTo, mTo] = timeTo.split(':').map(Number)
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const fromSecs = hFrom * 3600 + mFrom * 60
  const toSecs = hTo * 3600 + mTo * 60

  if (nowSecs >= fromSecs && nowSecs <= toSecs) {
    const diffSecs = toSecs - nowSecs
    return action === 'block'
      ? { isBlocked: true, statusText: `Снимется через ${formatTime(diffSecs)}` }
      : { isBlocked: false, statusText: `Заблокируется через ${formatTime(diffSecs)}` }
  } else if (nowSecs < fromSecs) {
    const diffSecs = fromSecs - nowSecs
    return action === 'block'
      ? { isBlocked: false, statusText: `Заблокируется через ${formatTime(diffSecs)}` }
      : { isBlocked: true, statusText: `Снимется через ${formatTime(diffSecs)}` }
  } else {
    return action === 'block'
      ? { isBlocked: false, statusText: 'Завершено на сегодня' }
      : { isBlocked: true, statusText: 'Завершено (заблокировано)' }
  }
}

function evaluateDateRule(rule, now, key, emptyText, wrongDayText, expiredText) {
  const data = rule[key]
  if (!data?.date || !data?.timeFrom || !data?.timeTo) {
    return { isBlocked: false, statusText: emptyText }
  }

  const action = data.action || 'block'
  const ruleDate = new Date(data.date)
  if (now.toDateString() !== ruleDate.toDateString()) {
    return action === 'block'
      ? { isBlocked: false, statusText: wrongDayText }
      : { isBlocked: true, statusText: `${wrongDayText} (заблокировано)` }
  }

  const [hFrom, mFrom] = data.timeFrom.split(':').map(Number)
  const [hTo, mTo] = data.timeTo.split(':').map(Number)
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const fromSecs = hFrom * 3600 + mFrom * 60
  const toSecs = hTo * 3600 + mTo * 60

  if (nowSecs >= fromSecs && nowSecs <= toSecs) {
    const diffSecs = toSecs - nowSecs
    return action === 'block'
      ? { isBlocked: true, statusText: `Снимется через ${formatTime(diffSecs)}` }
      : { isBlocked: false, statusText: `Заблокируется через ${formatTime(diffSecs)}` }
  } else if (nowSecs < fromSecs) {
    const diffSecs = fromSecs - nowSecs
    return action === 'block'
      ? { isBlocked: false, statusText: `Заблокируется через ${formatTime(diffSecs)}` }
      : { isBlocked: true, statusText: `Снимется через ${formatTime(diffSecs)}` }
  } else {
    return action === 'block'
      ? { isBlocked: false, statusText: expiredText }
      : { isBlocked: true, statusText: `${expiredText} (заблокировано)` }
  }
}

function evaluateMonthlyDateRule(rule, now) {
  if (!rule.monthly_date?.day || !rule.monthly_date?.timeFrom || !rule.monthly_date?.timeTo) {
    return { isBlocked: false, statusText: 'Число не настроено' }
  }

  const action = rule.monthly_date.action || 'block'
  if (now.getDate() !== rule.monthly_date.day) {
    return action === 'block'
      ? { isBlocked: false, statusText: 'В другой день' }
      : { isBlocked: true, statusText: 'В другой день (заблокировано)' }
  }

  const dateRule = {
    date: {
      date: now.toISOString(),
      timeFrom: rule.monthly_date.timeFrom,
      timeTo: rule.monthly_date.timeTo,
      action
    }
  }

  return evaluateDateRule(dateRule, now, 'date', 'Число не настроено', 'В другой день', 'Время прошло')
}

export function evaluateRule(rule, now = new Date()) {
  if (!rule || rule.status !== 'active') {
    return { isBlocked: false, statusText: null }
  }

  switch (rule.mode) {
    case 'permanent':
      return { isBlocked: true, statusText: 'Заблокировано' }

    case 'timer': {
      if (!rule.timer?.startedAt || !rule.timer?.duration) {
        return { isBlocked: false, statusText: 'Таймер не настроен' }
      }
      const startedAt = rule.timer.startedAt?.toDate?.() || new Date(rule.timer.startedAt)
      const durationMs = Number(rule.timer.duration) * 60 * 1000
      const endsAt = new Date(startedAt.getTime() + durationMs)
      const diffMs = endsAt - now

      if (diffMs > 0) {
        return { isBlocked: true, statusText: `Снимется через ${formatTime(Math.floor(diffMs / 1000))}` }
      }
      return { isBlocked: false, statusText: 'Время вышло' }
    }

    case 'schedule':
      return evaluateSchedule(rule, now)

    case 'profile':
      return evaluateSchedule(rule, now, 'режиму')

    case 'date':
      return evaluateDateRule(rule, now, 'date', 'Дата не настроена', 'В другой день', 'Время прошло')

    case 'monthly_date':
      return evaluateMonthlyDateRule(rule, now)

    default:
      return { isBlocked: false, statusText: null }
  }
}
