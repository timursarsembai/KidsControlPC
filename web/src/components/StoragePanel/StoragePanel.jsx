import React from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { listAllUserFiles, deleteFilesByPaths } from '@kidscontrol/shared/firebase/storage'
import { recalcStorageUsed } from '@kidscontrol/shared/firebase/profile'
import './StoragePanel.css'

function formatBytes(bytes) {
  if (!bytes) return '0 КБ'
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' ГБ'
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
  return (bytes / 1024).toFixed(0) + ' КБ'
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function pathContext(file) {
  const parts = file.fullPath.split('/')
  if (file.type === 'attachment') {
    // users/{uid}/chats/{chatId}/attachments/{name}
    return parts[3] ? 'Чат: ' + parts[3].slice(0, 8) + '…' : '—'
  }
  // users/{uid}/devices/{deviceId}/screenshots/{name}
  return parts[3] ? 'Устройство: ' + parts[3].slice(0, 8) + '…' : '—'
}

export default function StoragePanel() {
  const { activeOwnerUid, user, storageUsedBytes, storageQuotaBytes } = useRulesStore()
  const ownerUid = activeOwnerUid || user?.uid

  const [files, setFiles] = React.useState(null) // null=loading
  const [error, setError] = React.useState(null)
  const [selected, setSelected] = React.useState(new Set())
  const [deleting, setDeleting] = React.useState(false)
  const [progress, setProgress] = React.useState('')

  const load = React.useCallback(async () => {
    if (!ownerUid) return
    setFiles(null)
    setError(null)
    setSelected(new Set())
    try {
      const list = await listAllUserFiles(ownerUid)
      setFiles(list)
      // Sync counter with real storage state
      const actualBytes = list.reduce((sum, f) => sum + (f.size || 0), 0)
      await recalcStorageUsed(ownerUid, actualBytes)
    } catch (e) {
      setError(e.message)
      setFiles([])
    }
  }, [ownerUid])

  React.useEffect(() => { load() }, [load])

  const allPaths = files?.map(f => f.fullPath) || []
  const allSelected = files?.length > 0 && selected.size === files.length

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allPaths))
  }

  const toggleOne = (path) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const doDelete = async (paths, _label) => {
    if (!paths.length) return
    setDeleting(true)
    setProgress('Удаление...')
    try {
      await deleteFilesByPaths(paths, (done, total) => setProgress(`${done} / ${total}`))
      setProgress(`Удалено ${paths.length} файлов`)
      await load()
    } catch (e) {
      setProgress('Ошибка: ' + e.message)
    } finally {
      setDeleting(false)
      setTimeout(() => setProgress(''), 3000)
    }
  }

  const deleteSelected = () => doDelete([...selected], 'выбранные')

  const deleteAll = () => doDelete(allPaths, 'все')

  const deleteOlderThan = (ms) => {
    const cutoff = Date.now() - ms
    const old = (files || []).filter(f => new Date(f.timeCreated).getTime() < cutoff).map(f => f.fullPath)
    doDelete(old, 'старые')
  }

  const pct = storageQuotaBytes > 0 ? Math.min(100, (storageUsedBytes / storageQuotaBytes) * 100) : 0
  const barColor = pct >= 90 ? 'var(--danger, #ef4444)' : pct >= 70 ? '#f59e0b' : 'var(--accent)'

  return (
    <div className="storage-panel">
      <div className="storage-panel-header">
        <h2 className="storage-panel-title">Хранилище</h2>
        <div className="storage-panel-quota">
          <div className="storage-panel-quota-row">
            <span>{formatBytes(storageUsedBytes)} из {formatBytes(storageQuotaBytes)}</span>
            <span className="storage-panel-quota-pct">{pct.toFixed(0)}%</span>
          </div>
          <div className="storage-panel-quota-track">
            <div className="storage-panel-quota-fill" style={{ width: pct + '%', background: barColor }} />
          </div>
        </div>
      </div>

      <div className="storage-panel-toolbar">
        <div className="storage-panel-toolbar-left">
          {selected.size > 0 && (
            <button
              className="storage-btn storage-btn-danger"
              onClick={deleteSelected}
              disabled={deleting}
            >
              Удалить выбранные ({selected.size})
            </button>
          )}
          {selected.size === 0 && (
            <>
              <button className="storage-btn storage-btn-danger" onClick={deleteAll} disabled={deleting || !files?.length}>
                Удалить всё
              </button>
              <button className="storage-btn" onClick={() => deleteOlderThan(24 * 3600 * 1000)} disabled={deleting || !files?.length}>
                Старше 24 часов
              </button>
              <button className="storage-btn" onClick={() => deleteOlderThan(7 * 24 * 3600 * 1000)} disabled={deleting || !files?.length}>
                Старше 7 дней
              </button>
            </>
          )}
        </div>
        <div className="storage-panel-toolbar-right">
          {progress && <span className="storage-progress">{progress}</span>}
          <button className="storage-btn" onClick={load} disabled={deleting}>
            ↻ Обновить
          </button>
        </div>
      </div>

      {files === null && (
        <div className="storage-panel-loading">Загрузка файлов...</div>
      )}

      {error && (
        <div className="storage-panel-error">Ошибка: {error}</div>
      )}

      {files !== null && files.length === 0 && !error && (
        <div className="storage-panel-empty">Хранилище пусто</div>
      )}

      {files !== null && files.length > 0 && (
        <div className="storage-panel-table-wrap">
          <table className="storage-table">
            <thead>
              <tr>
                <th className="storage-col-check">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="storage-col-type">Тип</th>
                <th className="storage-col-name">Имя файла</th>
                <th className="storage-col-ctx">Контекст</th>
                <th className="storage-col-size">Размер</th>
                <th className="storage-col-date">Дата</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr
                  key={file.fullPath}
                  className={selected.has(file.fullPath) ? 'selected' : ''}
                  onClick={() => toggleOne(file.fullPath)}
                >
                  <td className="storage-col-check" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(file.fullPath)}
                      onChange={() => toggleOne(file.fullPath)}
                    />
                  </td>
                  <td className="storage-col-type">
                    <span className={`storage-type-badge storage-type-badge--${file.type}`}>
                      {file.type === 'screenshot' ? '📷 Скриншот' : '📎 Файл'}
                    </span>
                  </td>
                  <td className="storage-col-name" title={file.name}>{file.name}</td>
                  <td className="storage-col-ctx">{pathContext(file)}</td>
                  <td className="storage-col-size">{formatBytes(file.size)}</td>
                  <td className="storage-col-date">{formatDate(file.timeCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
