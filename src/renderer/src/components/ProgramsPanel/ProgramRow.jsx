import { DateInput, MonthlyDateInput, ScheduleInput, TimerInput } from './ModeConfigInputs'

export default function ProgramRow({
  app,
  mode,
  t,
  isPending,
  ruleData,
  updateRuleData,
  onBlock,
  onUnblock,
  onRemoteUninstall
}) {
  return (
    <tr>
      <td>
        <div className="prog-name-row">
          <div className="prog-name">{app.name}</div>
          {app.running && (
            <span className="prog-running-badge">● Работает</span>
          )}
        </div>
        {app.path
          ? <div className="prog-path">{app.path}</div>
          : <div className="prog-path no-path">{t('programs.path_unknown', 'Путь неизвестен')}</div>
        }
        {app.publisher && <div className="prog-publisher">{app.publisher}</div>}
      </td>

      {mode === 'timer' && (
        <td>
          <TimerInput value={ruleData[app.id]?.timer?.duration || app.rule?.timer?.duration || ''}
            onChange={v => updateRuleData(app.id, { ...ruleData[app.id], timer: { duration: v } })} />
        </td>
      )}
      {mode === 'schedule' && (
        <td>
          <ScheduleInput value={ruleData[app.id]?.schedule || app.rule?.schedule}
            onChange={v => updateRuleData(app.id, { ...ruleData[app.id], schedule: v })} />
        </td>
      )}
      {mode === 'date' && (
        <td>
          <DateInput value={ruleData[app.id]?.date || app.rule?.date}
            onChange={v => updateRuleData(app.id, { ...ruleData[app.id], date: v })} />
        </td>
      )}
      {mode === 'monthly_date' && (
        <td>
          <MonthlyDateInput value={ruleData[app.id]?.monthly_date || app.rule?.monthly_date}
            onChange={v => updateRuleData(app.id, { ...ruleData[app.id], monthly_date: v })} />
        </td>
      )}

      <td>
        <div className="status-cell">
          <span className={`status-dot ${app.blocked ? 'blocked' : 'unblocked'}`} />
          <span className="status-text">
            {app.blocked
              ? (app.isBlockedByTime ? t('programs.status_blocked', 'Заблокирован') : t('programs.status_waiting', 'Ожидание'))
              : t('programs.status_disabled', 'Отключен')}
          </span>
        </div>
        {app.statusText && mode !== 'permanent' && (
          <div className="countdown-text" style={{ fontSize: '0.75rem', color: '#8b8d98', marginTop: 2 }}>
            {app.statusText}
          </div>
        )}
      </td>

      <td>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className={`btn btn-sm ${app.blocked ? 'btn-success' : 'btn-danger'}`}
            disabled={isPending}
            onClick={() => app.blocked ? onUnblock(app) : onBlock(app)}
            style={{ flex: 1 }}
          >
            {isPending
              ? <span className="btn-spinner-sm" />
              : app.blocked ? t('programs.btn_disable', 'Отключить правило') : t('programs.btn_enable', 'Включить правило')
            }
          </button>
          <button
            className="btn btn-sm"
            style={{ padding: '0 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-danger)', fontSize: '1rem' }}
            title={t('programs.btn_uninstall', 'Удалить программу с ПК')}
            onClick={() => onRemoteUninstall(app)}
          >
            🗑️
          </button>
        </div>
      </td>
    </tr>
  )
}
