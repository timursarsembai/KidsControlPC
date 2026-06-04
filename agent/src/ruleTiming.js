export function getDayIndex(date) {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

function parseTimeToMinutes(value) {
  if (!value || typeof value !== 'string') return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
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
  const today = getDayIndex(now)
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
      return group.weekdays.includes(today)
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

export function shouldBlockBySchedule(schedule, now = new Date()) {
  const groups = getScheduleGroups(schedule)
  if (groups.length === 0) return false
  const today = getDayIndex(now)

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
