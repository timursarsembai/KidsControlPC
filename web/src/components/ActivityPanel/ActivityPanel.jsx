import React from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { subscribeToActivityLogs, subscribeToActivityStats } from '@kidscontrol/shared/firebase/activity'
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

// ── Horizontal bar chart for apps ────────────────────────────────────────────

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

// ── Vertical bar chart for screen time ───────────────────────────────────────

function VBarChart({ stats, today }) {
  if (!stats.length) return <div className="ap-empty">Нет данных</div>
  const maxSec = Math.max(...stats.map(s => s.screenTimeSec || 0), 1)
  return (
    <div className="ap-vbar-chart">
      {stats.map(s => {
        const sec = s.screenTimeSec || 0
        const pct = Math.max(sec > 0 ? 3 : 0, (sec / maxSec) * 100)
        const isToday = s.date === today
        return (
          <div key={s.date} className={`ap-vbar-col ${isToday ? 'ap-vbar-col--today' : ''}`}>
            <div className="ap-vbar-val">{sec > 0 ? fmtScreenTime(sec) : ''}</div>
            <div className="ap-vbar-wrap">
              <div className="ap-vbar-fill" style={{ height: pct + '%' }} title={fmtScreenTime(sec)} />
            </div>
            <div className="ap-vbar-label">{isToday ? 'сег' : fmtShortDay(s.date)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Apps Tab ─────────────────────────────────────────────────────────────────

function AppsTab({ logs, stats }) {
  const appLogs = logs.filter(l => l.type === 'app_launch' || l.type === 'app_close')

  const appsUsage = {}
  for (const stat of stats) {
    for (const [app, sec] of Object.entries(stat.appsUsage || {})) {
      appsUsage[app] = (appsUsage[app] || 0) + sec
    }
  }
  const topApps = Object.entries(appsUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const maxSec = topApps[0]?.[1] || 1

  return (
    <div className="ap-tab-content">
      <div className="ap-section">
        <div className="ap-section-title">Топ приложений за 7 дней</div>
        <HBarChart
          items={topApps.map(([name, sec]) => ({ label: name, value: sec, formatted: fmtDuration(sec) }))}
          maxValue={maxSec}
        />
      </div>

      <div className="ap-section">
        <div className="ap-section-title">События сегодня</div>
        {appLogs.length === 0 ? (
          <div className="ap-empty">Нет данных за сегодня</div>
        ) : (
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
                  <td className="ap-td-dim">{l.duration ? fmtDuration(l.duration) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Sites Tab ─────────────────────────────────────────────────────────────────

function SitesTab({ logs, stats }) {
  const siteLogs = logs.filter(l => l.type === 'site_blocked')

  const sitesBlocked = {}
  for (const stat of stats) {
    for (const [domain, count] of Object.entries(stat.sitesBlocked || {})) {
      sitesBlocked[domain] = (sitesBlocked[domain] || 0) + count
    }
  }
  const topSites = Object.entries(sitesBlocked)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const maxCount = topSites[0]?.[1] || 1

  return (
    <div className="ap-tab-content">
      <div className="ap-section">
        <div className="ap-section-title">Заблокированные сайты за 7 дней</div>
        <HBarChart
          items={topSites.map(([domain, count]) => ({ label: domain, value: count, formatted: `${count}×` }))}
          maxValue={maxCount}
          colorVar="var(--danger, #ef4444)"
        />
        {!topSites.length && <div className="ap-empty">Нет заблокированных сайтов</div>}
      </div>

      <div className="ap-section">
        <div className="ap-section-title">События сегодня</div>
        {siteLogs.length === 0 ? (
          <div className="ap-empty">Нет заблокированных сайтов за сегодня</div>
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
        )}
      </div>
    </div>
  )
}

// ── Screen Time Tab ───────────────────────────────────────────────────────────

function ScreenTimeTab({ stats }) {
  const today = new Date().toISOString().slice(0, 10)
  const todaySec = stats.find(s => s.date === today)?.screenTimeSec || 0
  const weekSec = stats.reduce((sum, s) => sum + (s.screenTimeSec || 0), 0)

  // Sort stats oldest→newest for the chart (left=oldest)
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
        <VBarChart stats={sorted} today={today} />
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ActivityPanel() {
  const { selectedDeviceId, activeOwnerUid, user } = useRulesStore()
  const ownerUid = activeOwnerUid || user?.uid

  const [tab, setTab] = React.useState('apps')
  const [logs, setLogs] = React.useState([])
  const [stats, setStats] = React.useState([])
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

  if (!selectedDeviceId) {
    return <div className="ap-panel"><div className="ap-empty">Выберите устройство</div></div>
  }

  return (
    <div className="ap-panel">
      <div className="ap-tabs">
        {[
          { id: 'apps',  icon: '⬛', label: 'Приложения' },
          { id: 'sites', icon: '🌐', label: 'Сайты' },
          { id: 'time',  icon: '⏱', label: 'Время за ПК' },
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

      {tab === 'apps'  && <AppsTab  logs={logs} stats={stats} />}
      {tab === 'sites' && <SitesTab logs={logs} stats={stats} />}
      {tab === 'time'  && <ScreenTimeTab stats={stats} />}
    </div>
  )
}
