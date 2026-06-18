import { evaluateRule } from '@kidscontrol/shared/utils/timeHelpers'

export default function ProfileTargetTable({
  activeSubTab,
  filteredPrograms,
  filteredWebsites,
  now,
  profileProgramRules,
  profileWebsiteRules,
  selectedPrograms,
  selectedWebsites,
  tableLoading,
  toggleProgram,
  toggleWebsite
}) {
  return (
    <div className="table-container profile-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>{activeSubTab === 'programs' ? 'Программа' : 'Сайт'}</th>
            <th style={{ width: 150 }}>В режиме</th>
            <th style={{ width: 180 }}>Сейчас</th>
          </tr>
        </thead>
        <tbody>
          {tableLoading ? (
            <tr>
              <td colSpan={3}>
                <div className="empty-state">
                  <div className="loading-spinner" />
                  <span className="empty-state-title">Загрузка списка...</span>
                </div>
              </td>
            </tr>
          ) : activeSubTab === 'programs' ? (
            filteredPrograms.map(app => {
              const rule = profileProgramRules.get(app.name)
              const evaluation = evaluateRule(rule, now)
              const checked = selectedPrograms.has(app.name)
              return (
                <tr key={app.id || app.name}>
                  <td>
                    <div className="prog-name">{app.name}</div>
                    {app.path
                      ? <div className="prog-path">{app.path}</div>
                      : <div className="prog-path no-path">Путь неизвестен</div>}
                  </td>
                  <td>
                    <label className="custom-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProgram(app.name)}
                      />
                      <span className="checkmark" />
                    </label>
                  </td>
                  <td>
                    <span className={`profile-status ${evaluation.isBlocked ? 'blocked' : checked ? 'waiting' : ''}`}>
                      {checked ? (evaluation.statusText || 'Сохраните режим') : 'Не выбрано'}
                    </span>
                  </td>
                </tr>
              )
            })
          ) : (
            filteredWebsites.map(site => {
              const pattern = site.resolvedPattern || site.inputUrl
              const rule = profileWebsiteRules.get(pattern)
              const evaluation = evaluateRule(rule, now)
              const checked = selectedWebsites.has(pattern)
              return (
                <tr key={pattern}>
                  <td>
                    <div className="prog-name">{pattern}</div>
                  </td>
                  <td>
                    <label className="custom-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWebsite(pattern)}
                      />
                      <span className="checkmark" />
                    </label>
                  </td>
                  <td>
                    <span className={`profile-status ${evaluation.isBlocked ? 'blocked' : checked ? 'waiting' : ''}`}>
                      {checked ? (evaluation.statusText || 'Сохраните режим') : 'Не выбрано'}
                    </span>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
