import React from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import {
  subscribeToActivityLogs,
  subscribeToActivityStats,
  subscribeToActivityStatsRange,
} from '@kidscontrol/shared/firebase/activity'
import './ActivityPanel.css'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(sec) {
  if (!sec || sec < 1) return '< 1 сек'
  if (sec < 60) return `${sec} сек`
  if (sec < 3600) return `${Math.floor(sec / 60)} мин`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

function fmtScreenTime(sec) {
  if (!sec || sec < 60) return sec ? `${sec} сек` : '0'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m} мин`
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

function fmtShortDay(dateStr) {
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
  const d = new Date(dateStr + 'T12:00:00')
  return days[d.getDay()]
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function useNow(intervalMs = 30000) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

// ── Horizontal bar chart for top apps ────────────────────────────────────────

function HBarChart({ items, maxValue, colorVar = 'var(--accent)' }) {
  if (!items.length) return <div className="ap-empty">Нет данных</div>
  return (
    <div className="ap-hbar-list">
      {items.map(({ label, value, formatted }) => {
        const pct = maxValue > 0 ? Math.max(2, (value / maxValue) * 100) : 2
        return (
          <div key={label} className="ap-hbar-row">
            <div className="ap-hbar-label" title={label}>{label}</div>
            <div className="ap-hbar-track">
              <div className="ap-hbar-fill" style={{ width: pct + '%', background: colorVar }} />
            </div>
            <div className="ap-hbar-val">{formatted}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Generic vertical bar chart ────────────────────────────────────────────────
// items: [{ label, sec, isHighlight? }]

function VBarChart({ items }) {
  const maxSec = Math.max(...items.map(i => i.sec || 0), 1)
  return (
    <div className="ap-vbar-chart">
      {items.map((item, idx) => {
        const sec = item.sec || 0
        const pct = Math.max(sec > 0 ? 3 : 0, (sec / maxSec) * 100)
        return (
          <div key={item.label + idx} className={`ap-vbar-col ${item.isHighlight ? 'ap-vbar-col--today' : ''}`}>
            <div className="ap-vbar-val">{sec > 0 ? fmtScreenTime(sec) : ''}</div>
            <div className="ap-vbar-wrap">
              <div className="ap-vbar-fill" style={{ height: pct + '%' }} title={fmtScreenTime(sec)} />
            </div>
            <div className="ap-vbar-label">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// Elapsed seconds since launch, capped at today's midnight (so cross-day sessions
// only count time from 00:00 today onward in daily/weekly/monthly aggregations)
function elapsedToday(launchTs, now) {
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  return Math.round((now - Math.max(launchTs, todayStart.getTime())) / 1000)
}

// ── Chart data helpers ────────────────────────────────────────────────────────

function appUsageTotal(stat) {
  return Object.values(stat.appsUsage || {}).reduce((sum, v) => sum + v, 0)
}

// Sum of still-running app seconds from today's logs (apps launched but not closed)
function runningSecFromLogs(appLogs, now) {
  const byName = {}
  for (const l of appLogs) {
    if (!byName[l.name]) byName[l.name] = l // newest first
  }
  let total = 0
  for (const newest of Object.values(byName)) {
    if (newest.type === 'app_launch' && newest.ts) {
      const launchTs = newest.ts.toDate ? newest.ts.toDate().getTime() : new Date(newest.ts).getTime()
      total += elapsedToday(launchTs, now)
    }
  }
  return total
}

function computeDayOfWeek(longStats, todayExtraSec) {
  const labels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const totals = [0, 0, 0, 0, 0, 0, 0]
  const todayDow = (new Date().getDay() + 6) % 7 // 0=Mon, 6=Sun
  for (const s of longStats) {
    const d = new Date(s.date + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7
    totals[dow] += appUsageTotal(s)
  }
  totals[todayDow] += todayExtraSec
  return labels.map((label, i) => ({ label, sec: totals[i], isHighlight: i === todayDow }))
}

function computeByMonth(longStats, todayExtraSec) {
  const monthLabels = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const totals = {}
  for (const s of longStats) {
    const key = s.date.slice(0, 7)
    totals[key] = (totals[key] || 0) + appUsageTotal(s)
  }
  const today = new Date()
  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  totals[thisMonthKey] = (totals[thisMonthKey] || 0) + todayExtraSec
  const items = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const isHighlight = i === 0
    items.push({ label: monthLabels[d.getMonth()], sec: totals[key] || 0, isHighlight })
  }
  return items
}

function aggregateStatsByApp(stats) {
  const apps = {}
  for (const s of stats) {
    for (const [app, sec] of Object.entries(s.appsUsage || {})) {
      apps[app] = (apps[app] || 0) + sec
    }
  }
  return Object.entries(apps).sort((a, b) => b[1] - a[1])
}

function aggregateLogsByApp(logs, now) {
  // Group events by app name (logs are desc order — newest first)
  const byName = {}
  for (const l of logs) {
    if (!byName[l.name]) byName[l.name] = []
    byName[l.name].push(l)
  }
  const apps = {}
  for (const [name, events] of Object.entries(byName)) {
    let total = 0
    for (const l of events) {
      if (l.type === 'app_close' && l.duration) total += l.duration
    }
    // If still running (newest event is a launch with no close after it)
    const newest = events[0]
    if (newest.type === 'app_launch' && newest.ts) {
      const launchTs = newest.ts.toDate ? newest.ts.toDate().getTime() : new Date(newest.ts).getTime()
      total += elapsedToday(launchTs, now)
    }
    if (total > 0) apps[name] = total
  }
  return Object.entries(apps).sort((a, b) => b[1] - a[1])
}

// ── Apps Tab ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: 'hours', label: 'По часам' },
  { value: 'day',   label: 'За сутки' },
  { value: 'week',  label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
]

function AppsTab({ logs, stats, longStats, now }) {
  const [period, setPeriod] = React.useState('hours')

  const appLogs = logs.filter(l => l.type === 'app_launch' || l.type === 'app_close')

  // Top apps chart (7 days) — stats + still-running apps from today's logs
  const appsUsage7 = {}
  for (const stat of stats) {
    for (const [app, sec] of Object.entries(stat.appsUsage || {})) {
      appsUsage7[app] = (appsUsage7[app] || 0) + sec
    }
  }
  const byNameTop = {}
  for (const l of appLogs) {
    if (!byNameTop[l.name]) byNameTop[l.name] = l
  }
  for (const [name, newest] of Object.entries(byNameTop)) {
    if (newest.type === 'app_launch' && newest.ts) {
      const launchTs = newest.ts.toDate ? newest.ts.toDate().getTime() : new Date(newest.ts).getTime()
      appsUsage7[name] = (appsUsage7[name] || 0) + elapsedToday(launchTs, now)
    }
  }
  const topApps = Object.entries(appsUsage7).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxSec7 = topApps[0]?.[1] || 1

  const todayExtraSec = React.useMemo(() => runningSecFromLogs(appLogs, now), [appLogs, now])
  const dowItems = React.useMemo(() => computeDayOfWeek(longStats, todayExtraSec), [longStats, todayExtraSec])
  const monthItems = React.useMemo(() => computeByMonth(longStats, todayExtraSec), [longStats, todayExtraSec])

  // Events table data based on period
  let aggregatedRows = null
  if (period === 'day') {
    aggregatedRows = aggregateLogsByApp(appLogs, now)
  } else if (period === 'week' || period === 'month') {
    const base = period === 'week' ? stats : longStats.slice(0, 30)
    const fromStats = Object.fromEntries(aggregateStatsByApp(base))
    // Add elapsed time for still-running apps (newest event = app_launch, no close yet)
    const byName = {}
    for (const l of appLogs) {
      if (!byName[l.name]) byName[l.name] = l // newest first — first seen = newest
    }
    for (const [name, newest] of Object.entries(byName)) {
      if (newest.type === 'app_launch' && newest.ts) {
        const launchTs = newest.ts.toDate ? newest.ts.toDate().getTime() : new Date(newest.ts).getTime()
        fromStats[name] = (fromStats[name] || 0) + elapsedToday(launchTs, now)
      }
    }
    aggregatedRows = Object.entries(fromStats).sort((a, b) => b[1] - a[1])
  }

  return (
    <div className="ap-tab-content">
      {/* Three charts in a row */}
      <div className="ap-charts-row">
        <div className="ap-chart-col">
          <div className="ap-section-title">Топ программ · 7 дней</div>
          <HBarChart
            items={topApps.map(([name, sec]) => ({ label: name, value: sec, formatted: fmtDuration(sec) }))}
            maxValue={maxSec7}
          />
        </div>
        <div className="ap-chart-col">
          <div className="ap-section-title">По дням недели</div>
          <VBarChart items={dowItems} />
        </div>
        <div className="ap-chart-col">
          <div className="ap-section-title">По месяцам</div>
          <VBarChart items={monthItems} />
        </div>
      </div>

      {/* Events table with period filter */}
      <div className="ap-section">
        <div className="ap-section-header">
          <div className="ap-section-title">События</div>
          <select
            className="ap-period-select"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {period === 'hours' ? (
          appLogs.length === 0 ? (
            <div className="ap-empty">Нет событий за сегодня</div>
          ) : (() => {
            // Determine which launches are still running (newest event per app is a launch)
            const newestByName = {}
            for (const l of appLogs) { // appLogs are desc (newest first)
              if (!newestByName[l.name]) newestByName[l.name] = l
            }
            const stillRunningIds = new Set(
              Object.values(newestByName).filter(l => l.type === 'app_launch').map(l => l.id)
            )
            return (
              <table className="ap-table">
                <thead>
                  <tr><th>Время</th><th>Приложение</th><th>Событие</th><th>В эфире</th></tr>
                </thead>
                <tbody>
                  {appLogs.map(l => (
                    <tr key={l.id}>
                      <td className="ap-td-mono">{fmtTime(l.ts)}</td>
                      <td className="ap-td-name">{l.name}</td>
                      <td>
                        <span className={`ap-badge ap-badge--${l.type === 'app_launch' ? 'launch' : 'close'}`}>
                          {l.type === 'app_launch' ? '▶ Запуск' : '■ Закрыт'}
                        </span>
                      </td>
                      <td className="ap-td-dim">
                        {l.type === 'app_close' && l.duration
                          ? fmtDuration(l.duration)
                          : l.type === 'app_launch' && stillRunningIds.has(l.id) && l.ts
                            ? <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
                                {fmtDuration(Math.round((now - (l.ts.toDate ? l.ts.toDate() : new Date(l.ts)).getTime()) / 1000))}
                              </span>
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()
        ) : (
          !aggregatedRows || aggregatedRows.length === 0 ? (
            <div className="ap-empty">Нет данных за выбранный период</div>
          ) : (
            <table className="ap-table">
              <thead>
                <tr><th>Приложение</th><th>Время использования</th></tr>
              </thead>
              <tbody>
                {aggregatedRows.map(([name, sec]) => (
                  <tr key={name}>
                    <td className="ap-td-name">{name}</td>
                    <td className="ap-td-dim">{fmtDuration(sec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

// ── Sites Tab ─────────────────────────────────────────────────────────────────

function computeSiteDayOfWeek(longStats) {
  const labels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const totals = [0, 0, 0, 0, 0, 0, 0]
  const todayDow = (new Date().getDay() + 6) % 7
  for (const s of longStats) {
    const d = new Date(s.date + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7
    totals[dow] += Object.values(s.sitesBlocked || {}).reduce((sum, v) => sum + v, 0)
  }
  return labels.map((label, i) => ({ label, sec: totals[i], isHighlight: i === todayDow }))
}

function computeSiteByMonth(longStats) {
  const monthLabels = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const totals = {}
  for (const s of longStats) {
    const key = s.date.slice(0, 7)
    totals[key] = (totals[key] || 0) + Object.values(s.sitesBlocked || {}).reduce((sum, v) => sum + v, 0)
  }
  const today = new Date()
  const items = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    items.push({ label: monthLabels[d.getMonth()], sec: totals[key] || 0, isHighlight: i === 0 })
  }
  return items
}

const SITE_PERIOD_OPTIONS = [
  { value: 'hours', label: 'По часам' },
  { value: 'day',   label: 'За сутки' },
  { value: 'week',  label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
]

function SitesTab({ logs, stats, longStats }) {
  const [period, setPeriod] = React.useState('hours')

  const siteLogs = logs.filter(l => l.type === 'site_blocked')

  // Top sites chart (7 days)
  const sitesBlocked7 = {}
  for (const stat of stats) {
    for (const [domain, count] of Object.entries(stat.sitesBlocked || {})) {
      sitesBlocked7[domain] = (sitesBlocked7[domain] || 0) + count
    }
  }
  const topSites = Object.entries(sitesBlocked7).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxCount = topSites[0]?.[1] || 1

  const dowItems = React.useMemo(() => computeSiteDayOfWeek(longStats), [longStats])
  const monthItems = React.useMemo(() => computeSiteByMonth(longStats), [longStats])

  // Aggregated rows for non-hourly periods
  let aggregatedRows = null
  const aggregateSiteStats = (statsList) => {
    const acc = {}
    for (const s of statsList) {
      for (const [domain, count] of Object.entries(s.sitesBlocked || {})) {
        acc[domain] = (acc[domain] || 0) + count
      }
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }
  if (period === 'day') {
    const acc = {}
    for (const l of siteLogs) { acc[l.name] = (acc[l.name] || 0) + 1 }
    aggregatedRows = Object.entries(acc).sort((a, b) => b[1] - a[1])
  } else if (period === 'week') {
    aggregatedRows = aggregateSiteStats(stats)
  } else if (period === 'month') {
    aggregatedRows = aggregateSiteStats(longStats.slice(0, 30))
  }

  return (
    <div className="ap-tab-content">
      {/* Three charts in a row */}
      <div className="ap-charts-row">
        <div className="ap-chart-col">
          <div className="ap-section-title">Топ заблокированных · 7 дней</div>
          <HBarChart
            items={topSites.map(([domain, count]) => ({ label: domain, value: count, formatted: `${count}×` }))}
            maxValue={maxCount}
            colorVar="var(--danger, #ef4444)"
          />
        </div>
        <div className="ap-chart-col">
          <div className="ap-section-title">По дням недели</div>
          <VBarChart items={dowItems} />
        </div>
        <div className="ap-chart-col">
          <div className="ap-section-title">По месяцам</div>
          <VBarChart items={monthItems} />
        </div>
      </div>

      {/* Events table with period filter */}
      <div className="ap-section">
        <div className="ap-section-header">
          <div className="ap-section-title">События</div>
          <select
            className="ap-period-select"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            {SITE_PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {period === 'hours' ? (
          siteLogs.length === 0 ? (
            <div className="ap-empty">Нет событий за сегодня</div>
          ) : (
            <table className="ap-table">
              <thead>
                <tr><th>Время</th><th>Домен</th><th>Статус</th></tr>
              </thead>
              <tbody>
                {siteLogs.map(l => (
                  <tr key={l.id}>
                    <td className="ap-td-mono">{fmtTime(l.ts)}</td>
                    <td className="ap-td-name">{l.name}</td>
                    <td><span className="ap-badge ap-badge--blocked">🚫 Заблокирован</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          !aggregatedRows || aggregatedRows.length === 0 ? (
            <div className="ap-empty">Нет данных за выбранный период</div>
          ) : (
            <table className="ap-table">
              <thead>
                <tr><th>Домен</th><th>Блокировок</th></tr>
              </thead>
              <tbody>
                {aggregatedRows.map(([domain, count]) => (
                  <tr key={domain}>
                    <td className="ap-td-name">{domain}</td>
                    <td className="ap-td-dim">{count}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

// ── Screen Time Tab ───────────────────────────────────────────────────────────

function ScreenTimeTab({ stats }) {
  const today = localDateStr()
  const todaySec = stats.find(s => s.date === today)?.screenTimeSec || 0
  const weekSec = stats.reduce((sum, s) => sum + (s.screenTimeSec || 0), 0)
  const sorted = [...stats].sort((a, b) => a.date > b.date ? 1 : -1)

  return (
    <div className="ap-tab-content">
      <div className="ap-section">
        <div className="ap-kpi-row">
          <div className="ap-kpi">
            <div className="ap-kpi-val">{fmtScreenTime(todaySec)}</div>
            <div className="ap-kpi-label">Сегодня</div>
          </div>
          <div className="ap-kpi-divider" />
          <div className="ap-kpi">
            <div className="ap-kpi-val">{fmtScreenTime(weekSec)}</div>
            <div className="ap-kpi-label">За 7 дней</div>
          </div>
          <div className="ap-kpi-divider" />
          <div className="ap-kpi">
            <div className="ap-kpi-val">{stats.length > 0 ? fmtScreenTime(Math.round(weekSec / stats.length)) : '—'}</div>
            <div className="ap-kpi-label">Среднее в день</div>
          </div>
        </div>
      </div>

      <div className="ap-section">
        <div className="ap-section-title">По дням</div>
        <VBarChart items={sorted.map(s => ({
          label: s.date === today ? 'сег' : fmtShortDay(s.date),
          sec: s.screenTimeSec || 0,
          isHighlight: s.date === today,
        }))} />
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ActivityPanel() {
  const { selectedDeviceId, activeOwnerUid, user } = useRulesStore()
  const ownerUid = activeOwnerUid || user?.uid

  const [tab, setTab] = React.useState('apps')
  const now = useNow(30000)
  const [logs, setLogs] = React.useState([])
  const [stats, setStats] = React.useState([])
  const [longStats, setLongStats] = React.useState([])
  const [date] = React.useState(new Date())

  React.useEffect(() => {
    if (!ownerUid || !selectedDeviceId) return
    const unsub = subscribeToActivityLogs(ownerUid, selectedDeviceId, date, setLogs)
    return unsub
  }, [ownerUid, selectedDeviceId])

  React.useEffect(() => {
    if (!ownerUid || !selectedDeviceId) return
    const unsub = subscribeToActivityStats(ownerUid, selectedDeviceId, 7, setStats)
    return unsub
  }, [ownerUid, selectedDeviceId])

  React.useEffect(() => {
    if (!ownerUid || !selectedDeviceId) return
    const end = localDateStr()
    const startD = new Date()
    startD.setDate(startD.getDate() - 364)
    const start = localDateStr(startD)
    const unsub = subscribeToActivityStatsRange(ownerUid, selectedDeviceId, start, end, setLongStats)
    return unsub
  }, [ownerUid, selectedDeviceId])

  if (!selectedDeviceId) {
    return <div className="ap-panel"><div className="ap-empty">Выберите устройство</div></div>
  }

  return (
    <div className="ap-panel">
      <div className="ap-tabs">
        {[
          { id: 'apps',  icon: '⬛', label: 'Приложения' },
          { id: 'sites', icon: '🌐', label: 'Сайты' },
        ].map(t => (
          <button
            key={t.id}
            className={`ap-tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'apps'  && <AppsTab  logs={logs} stats={stats} longStats={longStats} now={now} />}
      {tab === 'sites' && <SitesTab logs={logs} stats={stats} longStats={longStats} />}
    </div>
  )
}
