import React, { useEffect, useMemo, useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import TimeInput from '../TimeInput/TimeInput'
import './ScreenshotsPanel.css'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function normalizeSettings(device) {
  const settings = device?.screenshots || {}
  const group = settings.schedule?.groups?.[0] || {}
  const range = group.ranges?.[0] || {}
  return {
    enabled: Boolean(settings.enabled),
    weekdays: Array.isArray(group.weekdays) && group.weekdays.length ? group.weekdays : [0, 1, 2, 3, 4, 5, 6],
    timeFrom: range.timeFrom || '10:00',
    timeTo: range.timeTo || '20:00',
    intervalMinutes: Math.max(1, Number(settings.intervalMinutes || 5)),
    quality: Math.max(20, Math.min(95, Number(settings.quality || 70))),
    maxWidth: Math.max(320, Math.min(3840, Number(settings.maxWidth || 1280)))
  }
}

async function downloadBlob(url, filename) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

export default function ScreenshotsPanel() {
  const {
    selectedDeviceId,
    devices,
    screenshots,
    updateDeviceSettings,
    requestScreenshot,
    deleteScreenshot,
    getScreenshotDownloadURL
  } = useRulesStore()

  const selectedDevice = devices.find(device => device.id === selectedDeviceId)
  const initialSettings = useMemo(() => normalizeSettings(selectedDevice), [selectedDevice])
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [lastManualRequestAt, setLastManualRequestAt] = useState(0)
  const [statusText, setStatusText] = useState('')

  useEffect(() => {
    setSettings(initialSettings)
  }, [initialSettings])

  const toggleDay = (dayIndex) => {
    setSettings(prev => ({
      ...prev,
      weekdays: prev.weekdays.includes(dayIndex)
        ? prev.weekdays.filter(day => day !== dayIndex)
        : [...prev.weekdays, dayIndex].sort()
    }))
  }

  const saveSettings = async () => {
    if (settings.weekdays.length === 0) {
      setStatusText('Выберите хотя бы один день недели')
      return
    }

    setSaving(true)
    setStatusText('')
    try {
      await updateDeviceSettings({
        screenshots: {
          enabled: settings.enabled,
          intervalMinutes: Math.max(1, Number(settings.intervalMinutes || 1)),
          quality: Math.max(20, Math.min(95, Number(settings.quality || 70))),
          maxWidth: Math.max(320, Math.min(3840, Number(settings.maxWidth || 1280))),
          schedule: {
            groups: [{
              action: 'allow',
              weekdays: settings.weekdays,
              ranges: [{ timeFrom: settings.timeFrom, timeTo: settings.timeTo }]
            }]
          }
        }
      })
      setStatusText('Настройки скриншотов сохранены')
    } catch (err) {
      setStatusText(`Ошибка сохранения: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleManualRequest = async () => {
    const now = Date.now()
    if (now - lastManualRequestAt < 60 * 1000) {
      setStatusText(`Следующий ручной запрос можно через ${Math.ceil((60 * 1000 - (now - lastManualRequestAt)) / 1000)} сек.`)
      return
    }

    setRequesting(true)
    setStatusText('')
    try {
      await requestScreenshot()
      setLastManualRequestAt(now)
      setStatusText('Запрос отправлен. Скрин появится ниже, когда агент его загрузит.')
    } catch (err) {
      setStatusText(`Ошибка запроса: ${err.message}`)
    } finally {
      setRequesting(false)
    }
  }

  const handleDownload = async (screenshot) => {
    if (!screenshot.storagePath && !screenshot.dataUrl) return
    setDownloadingId(screenshot.id)
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const downloadURL = screenshot.dataUrl || await getScreenshotDownloadURL(screenshot)
      await downloadBlob(downloadURL, `kidscontrol-screenshot-${stamp}.jpg`)
      await deleteScreenshot(screenshot)
      setStatusText('Скрин скачан и удалён из облака')
    } catch (err) {
      setStatusText(`Ошибка скачивания: ${err.message}`)
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="screenshots-panel animate-in">
      <div className="screenshots-card">
        <div className="screenshots-header">
          <div>
            <h2 className="screenshots-title">Скриншоты экрана</h2>
            <p className="screenshots-desc">Скрин делает helper в пользовательской сессии. Минимальный интервал — 1 минута.</p>
          </div>
          <button className="btn btn-primary" onClick={handleManualRequest} disabled={requesting}>
            {requesting ? <span className="btn-spinner-sm" /> : 'Получить скрин сейчас'}
          </button>
        </div>

        <div className="screenshots-settings">
          <label className="screenshots-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={event => setSettings(prev => ({ ...prev, enabled: event.target.checked }))}
            />
            <span>Включить автоматические скриншоты по расписанию</span>
          </label>

          <div className="screenshots-grid">
            <div>
              <div className="screenshots-label">Дни</div>
              <div className="screenshots-days">
                {DAYS.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    className={`screenshots-day ${settings.weekdays.includes(index) ? 'active' : ''}`}
                    onClick={() => toggleDay(index)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="screenshots-label">Окно времени</div>
              <div className="screenshots-time-row">
                <TimeInput value={settings.timeFrom} onChange={timeFrom => setSettings(prev => ({ ...prev, timeFrom }))} />
                <span>—</span>
                <TimeInput value={settings.timeTo} onChange={timeTo => setSettings(prev => ({ ...prev, timeTo }))} />
              </div>
            </div>

            <label>
              <span className="screenshots-label">Интервал, мин</span>
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={settings.intervalMinutes}
                onChange={event => setSettings(prev => ({ ...prev, intervalMinutes: event.target.value }))}
              />
            </label>

            <label>
              <span className="screenshots-label">Ширина, px</span>
              <input
                className="input"
                type="number"
                min="320"
                max="3840"
                step="10"
                value={settings.maxWidth}
                onChange={event => setSettings(prev => ({ ...prev, maxWidth: event.target.value }))}
              />
            </label>

            <label>
              <span className="screenshots-label">JPEG качество</span>
              <input
                className="input"
                type="number"
                min="20"
                max="95"
                step="5"
                value={settings.quality}
                onChange={event => setSettings(prev => ({ ...prev, quality: event.target.value }))}
              />
            </label>
          </div>

          <button className="btn btn-primary screenshots-save" onClick={saveSettings} disabled={saving}>
            {saving ? <span className="btn-spinner-sm" /> : 'Сохранить настройки'}
          </button>
        </div>

        {statusText && <div className="screenshots-status">{statusText}</div>}
      </div>

      <div className="screenshots-card">
        <h3 className="screenshots-subtitle">Готовые скрины</h3>
        {screenshots.length === 0 ? (
          <div className="screenshots-empty">Пока нет скринов для скачивания.</div>
        ) : (
          <div className="screenshots-list">
            {screenshots.map(screenshot => (
              <div className="screenshots-item" key={screenshot.id}>
                <div>
                  <div className="screenshots-item-title">{screenshot.source === 'scheduled' ? 'По расписанию' : 'Ручной запрос'}</div>
                  <div className="screenshots-item-meta">
                    {screenshot.createdAt?.toDate?.().toLocaleString?.() || 'только что'} · {Math.round((screenshot.size || 0) / 1024)} KB
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => handleDownload(screenshot)} disabled={downloadingId === screenshot.id}>
                  {downloadingId === screenshot.id ? <span className="btn-spinner-sm" /> : 'Скачать и удалить'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
