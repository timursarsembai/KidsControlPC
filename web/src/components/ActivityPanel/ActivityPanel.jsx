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
  if (sec < 3600) return `${Math.floor(sec / 60)} мин ${sec % 60} сек`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h} ч ${m} мин`
}

function fmtScreenTime(sec) {
  if (!sec) return '0 мин'
  if (sec < 60) return `${sec} сек`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m} мин`
  return `${h} ч ${m} мин`
}

// ── Apps Tab ─────────────────────────────────────────────────────────────────

function AppsTab({ logs, stats }) {
  const appLogs = logs.filter(l => l.type === 'app_launch' || l.type === 'app_close')

  // Build per-app usage from stats
  const appsUsage = {}
  for (const stat of stats) {
    for (const [app, sec] of Object.entries(stat.appsUsage || {})) {
      appsUsage[app] = (appsUsage[app] || 0) + sec
    }
  }
  const topApps = Object.entries(appsUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  return (
    <div className="activity-tab-content">
      {topApps.length > 0 && (
        <div className="activity-section">
          <div className="activity-section-title">Топ приложений (7 дней)</div>
          <div className="activity-app-list">
            {topApps.map(([name, sec]) => (
              <div key={name} className="activity-app-row">
                <span className="activity-app-name">{name}</span>
                <span className="activity-app-time">{fmtDuration(sec)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="activity-section">
        <div className="activity-section-title">События сегодня</div>
        {appLogs.length === 0 ? (
          <div className="activity-empty">Нет данных за сегодня</div>
        ) : (
          <table className="activity-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Приложение</th>
                <th>Событие</th>
                <th>Длительность</th>
              </tr>
            </thead>
            <tbody>
              {appLogs.map(l => (
                <tr key={l.id}>
                  <td className="activity-td-time">{fmtTime(l.ts)}</td>
                  <td className="activity-td-name">{l.name}</td>
                  <td>
                    <span className={`activity-badge activity-badge--${l.type === 'app_launch' ? 'launch' : 'close'}`}>
                      {l.type === 'app_launch' ? 'Запуск' : 'Закрыт'}
                    </span>
                  </td>
                  <td>{l.duration ? fmtDuration(l.duration) : '—'}</td>
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
    .slice(0, 10)

  return (
    <div className="activity-tab-content">
      {topSites.length > 0 && (
        <div className="activity-section">
          <div className="activity-section-title">Заблокированные сайты (7 дней)</div>
          <div className="activity-app-list">
            {topSites.map(([domain, count]) => (
              <div key={domain} className="activity-app-row">
                <span className="activity-app-name">{domain}</span>
                <span className="activity-app-time">{count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="activity-section">
        <div className="activity-section-title">События сегодня</div>
        {siteLogs.length === 0 ? (
          <div className="activity-empty">Нет заблокированных сайтов за сегодня</div>
        ) : (
          <table className="activity-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Домен</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {siteLogs.map(l => (
                <tr key={l.id}>
                  <td className="activity-td-time">{fmtTime(l.ts)}</td>
                  <td className="activity-td-name">{l.name}</td>
                  <td><span className="activity-badge activity-badge--blocked">Заблокирован</span></td>
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
  const todayStat = stats.find(s => s.date === today)
  const todaySec = todayStat?.screenTimeSec || 0

  const maxSec = Math.max(...stats.map(s => s.screenTimeSec || 0), 1)

  return (
    <div className="activity-tab-content">
      <div className="activity-section">
        <div className="activity-section-title">Сегодня</div>
        <div className="activity-screen-today">{fmtScreenTime(todaySec)}</div>
      </div>

      <div className="activity-section">
        <div className="activity-section-title">За последние 7 дней</div>
        {stats.length === 0 ? (
          <div className="activity-empty">Нет данных</div>
        ) : (
          <div className="activity-bar-chart">
            {stats.map(s => {
              const pct = Math.round(((s.screenTimeSec || 0) / maxSec) * 100)
              const isToday = s.date === today
              const label = isToday ? 'Сег' : new Date(s.date + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'short' })
              return (
                <div key={s.date} className="activity-bar-col">
                  <div className="activity-bar-wrap">
                    <div
                      className={`activity-bar-fill ${isToday ? 'activity-bar-fill--today' : ''}`}
                      style={{ height: pct + '%' }}
                      title={fmtScreenTime(s.screenTimeSec || 0)}
                    />
                  </div>
                  <div className="activity-bar-label">{label}</div>
                  <div className="activity-bar-val">{fmtScreenTime(s.screenTimeSec || 0)}</div>
                </div>
              )
            })}
          </div>
        )}
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
    return (
      <div className="activity-panel">
        <div className="activity-empty">Выберите устройство в сайдбаре</div>
      </div>
    )
  }

  return (
    <div className="activity-panel">
      <div className="activity-tabs">
        <button className={`activity-tab-btn ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
            <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          Приложения
        </button>
        <button className={`activity-tab-btn ${tab === 'sites' ? 'active' : ''}`} onClick={() => setTab('sites')}>
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7.5 1.5c-2 2-2 9 0 12M7.5 1.5c2 2 2 9 0 12" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1.5 7.5h12" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          Сайты
        </button>
        <button className={`activity-tab-btn ${tab === 'time' ? 'active' : ''}`} onClick={() => setTab('time')}>
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7.5 4v3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Время за ПК
        </button>
      </div>

      {tab === 'apps' && <AppsTab logs={logs} stats={stats} />}
      {tab === 'sites' && <SitesTab logs={logs} stats={stats} />}
      {tab === 'time' && <ScreenTimeTab stats={stats} />}
    </div>
  )
}
