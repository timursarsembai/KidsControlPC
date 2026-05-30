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
        const totalSecs = Math.floor(diffMs / 1000)
        const h = Math.floor(totalSecs / 3600)
        const m = Math.floor((totalSecs % 3600) / 60)
        const s = totalSecs % 60
        const timeStr = h > 0 
          ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` 
          : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        return { isBlocked: true, statusText: `Снимется через ${timeStr}` }
      } else {
        return { isBlocked: false, statusText: 'Время вышло' }
      }
    }

    case 'schedule': {
      if (!rule.schedule?.weekdays || !rule.schedule?.timeFrom || !rule.schedule?.timeTo) {
        return { isBlocked: false, statusText: 'Расписание не настроено' }
      }
      const action = rule.schedule.action || 'block'
      const dayOfWeek = now.getDay()
      const mappedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Mon=0
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

      const formatTime = (secs) => {
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        const s = secs % 60
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      }

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

    case 'date': {
      if (!rule.date?.date || !rule.date?.timeFrom || !rule.date?.timeTo) {
        return { isBlocked: false, statusText: 'Дата не настроена' }
      }
      const action = rule.date.action || 'block'
      const ruleDate = new Date(rule.date.date)
      if (now.toDateString() !== ruleDate.toDateString()) {
        return action === 'block'
          ? { isBlocked: false, statusText: 'В другой день' }
          : { isBlocked: true, statusText: 'В другой день (заблокировано)' }
      }
      
      const [hFrom, mFrom] = rule.date.timeFrom.split(':').map(Number)
      const [hTo, mTo] = rule.date.timeTo.split(':').map(Number)
      const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      const fromSecs = hFrom * 3600 + mFrom * 60
      const toSecs = hTo * 3600 + mTo * 60

      const formatTime = (secs) => {
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        const s = secs % 60
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      }

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
          ? { isBlocked: false, statusText: 'Время прошло' }
          : { isBlocked: true, statusText: 'Время прошло (заблокировано)' }
      }
    }

    case 'monthly_date': {
      if (!rule.monthly_date?.day || !rule.monthly_date?.timeFrom || !rule.monthly_date?.timeTo) {
        return { isBlocked: false, statusText: 'Число не настроено' }
      }
      const action = rule.monthly_date.action || 'block'
      if (now.getDate() !== rule.monthly_date.day) {
        return action === 'block'
          ? { isBlocked: false, statusText: 'В другой день' }
          : { isBlocked: true, statusText: 'В другой день (заблокировано)' }
      }
      
      const [hFrom, mFrom] = rule.monthly_date.timeFrom.split(':').map(Number)
      const [hTo, mTo] = rule.monthly_date.timeTo.split(':').map(Number)
      const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      const fromSecs = hFrom * 3600 + mFrom * 60
      const toSecs = hTo * 3600 + mTo * 60

      const formatTime = (secs) => {
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        const s = secs % 60
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      }

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
          ? { isBlocked: false, statusText: 'Время прошло' }
          : { isBlocked: true, statusText: 'Время прошло (заблокировано)' }
      }
    }

    default:
      return { isBlocked: false, statusText: null }
  }
}
