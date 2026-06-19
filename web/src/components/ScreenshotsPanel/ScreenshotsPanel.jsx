import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import TimeInput from '../TimeInput/TimeInput'
import './ScreenshotsPanel.css'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MANUAL_SCREENSHOT_INTERVAL_MS = 15 * 1000
const MIN_SCHEDULED_INTERVAL_MINUTES = 60

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeSettings(device) {
  const settings = device?.screenshots || {}
  const group = settings.schedule?.groups?.[0] || {}
  const range = group.ranges?.[0] || {}
  return {
    enabled: Boolean(settings.enabled),
    weekdays: Array.isArray(group.weekdays) && group.weekdays.length ? group.weekdays : [0, 1, 2, 3, 4, 5, 6],
    timeFrom: range.timeFrom || '10:00',
    timeTo: range.timeTo || '20:00',
    intervalMinutes: Math.max(MIN_SCHEDULED_INTERVAL_MINUTES, Number(settings.intervalMinutes || MIN_SCHEDULED_INTERVAL_MINUTES)),
    quality: Math.max(20, Math.min(95, Number(settings.quality || 70))),
    maxWidth: Math.max(320, Math.min(3840, Number(settings.maxWidth || 1280)))
  }
}

function formatDay(date) {
  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === today) return 'Сегодня'
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatMeta(screenshot) {
  const date = toDate(screenshot.createdAt)
  const dateText = date ? date.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'только что'
  const sizeText = screenshot.size ? `${Math.round(screenshot.size / 1024)} KB` : 'размер неизвестен'
  return `${dateText} · ${sizeText}`
}

function buildFilename(screenshot) {
  const date = toDate(screenshot.createdAt) || new Date()
  const stamp = date.toISOString().replace(/[:.]/g, '-')
  const source = screenshot.source === 'scheduled' ? 'scheduled' : 'manual'
  return `kidscontrol-screenshot-${source}-${stamp}.jpg`
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
    markScreenshotDownloaded,
    getScreenshotDownloadURL,
    getScreenshotFullDownloadURL
  } = useRulesStore()

  const selectedDevice = devices.find(device => device.id === selectedDeviceId)
  const initialSettings = useMemo(() => normalizeSettings(selectedDevice), [selectedDevice])
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [bulkAction, setBulkAction] = useState(null)
  const [lastManualRequestAt, setLastManualRequestAt] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [imageUrls, setImageUrls] = useState({})
  const [fullImageUrls, setFullImageUrls] = useState({})
  const [selectedScreenshotId, setSelectedScreenshotId] = useState(null)

  useEffect(() => {
    setSettings(initialSettings)
  }, [initialSettings])

  useEffect(() => {
    if (!selectedScreenshotId) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedScreenshotId(null)
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      const index = screenshots.findIndex(screenshot => screenshot.id === selectedScreenshotId)
      if (index < 0 || screenshots.length === 0) return

      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const nextIndex = (index + direction + screenshots.length) % screenshots.length
      setSelectedScreenshotId(screenshots[nextIndex].id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedScreenshotId, screenshots])

  useEffect(() => {
    let cancelled = false

    async function loadImageUrls() {
      const entries = await Promise.all(screenshots.map(async (screenshot) => {
        if (screenshot.dataUrl) return [screenshot.id, screenshot.dataUrl]
        if (!screenshot.storagePath && !screenshot.thumbnailStoragePath) return [screenshot.id, null]
        try {
          return [screenshot.id, await getScreenshotDownloadURL(screenshot)]
        } catch {
          return [screenshot.id, null]
        }
      }))

      if (!cancelled) setImageUrls(Object.fromEntries(entries))
    }

    loadImageUrls()
    return () => { cancelled = true }
  }, [screenshots, getScreenshotDownloadURL])

  const groupedScreenshots = useMemo(() => {
    const groups = []
    const byKey = new Map()
    for (const screenshot of screenshots) {
      const date = toDate(screenshot.createdAt) || new Date()
      const key = date.toISOString().slice(0, 10)
      if (!byKey.has(key)) {
        const group = { key, title: formatDay(date), items: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).items.push(screenshot)
    }
    return groups
  }, [screenshots])

  const selectedScreenshot = screenshots.find(screenshot => screenshot.id === selectedScreenshotId)
  const selectedIndex = selectedScreenshot ? screenshots.findIndex(screenshot => screenshot.id === selectedScreenshot.id) : -1
  const selectedImageSrc = selectedScreenshot ? fullImageUrls[selectedScreenshot.id] || imageUrls[selectedScreenshot.id] : null

  const getImageSrc = (screenshot) => imageUrls[screenshot.id] || screenshot.dataUrl || ''

  const ensureFullImageUrl = async (screenshot) => {
    if (!screenshot) return null
    if (screenshot.dataUrl) return screenshot.dataUrl
    if (fullImageUrls[screenshot.id]) return fullImageUrls[screenshot.id]
    const url = await getScreenshotFullDownloadURL(screenshot)
    setFullImageUrls(prev => ({ ...prev, [screenshot.id]: url }))
    return url
  }

  const openViewer = async (screenshot) => {
    setSelectedScreenshotId(screenshot.id)
    try {
      await ensureFullImageUrl(screenshot)
    } catch {
      // Keep thumbnail/preview visible if the full image is unavailable.
    }
  }

  const moveViewer = (direction) => {
    if (selectedIndex < 0 || screenshots.length === 0) return
    const nextIndex = (selectedIndex + direction + screenshots.length) % screenshots.length
    openViewer(screenshots[nextIndex])
  }

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
          intervalMinutes: Math.max(MIN_SCHEDULED_INTERVAL_MINUTES, Number(settings.intervalMinutes || MIN_SCHEDULED_INTERVAL_MINUTES)),
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
    if (now - lastManualRequestAt < MANUAL_SCREENSHOT_INTERVAL_MS) {
      setStatusText(`Следующий ручной запрос можно через ${Math.ceil((MANUAL_SCREENSHOT_INTERVAL_MS - (now - lastManualRequestAt)) / 1000)} сек.`)
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
    setBusyId(screenshot.id)
    try {
      const downloadURL = screenshot.dataUrl || await getScreenshotFullDownloadURL(screenshot)
      await downloadBlob(downloadURL, buildFilename(screenshot))
      await markScreenshotDownloaded(screenshot.id)
      setStatusText('Скрин скачан')
    } catch (err) {
      setStatusText(`Ошибка скачивания: ${err.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (screenshot) => {
    setBusyId(screenshot.id)
    try {
      await deleteScreenshot(screenshot)
      setStatusText('Скрин удалён')
    } catch (err) {
      setStatusText(`Ошибка удаления: ${err.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const handleDownloadAll = async () => {
    setBulkAction('download')
    try {
      for (const screenshot of screenshots) {
        if (!screenshot.storagePath && !screenshot.dataUrl) continue
        const downloadURL = screenshot.dataUrl || await getScreenshotFullDownloadURL(screenshot)
        await downloadBlob(downloadURL, buildFilename(screenshot))
        await markScreenshotDownloaded(screenshot.id)
      }
      setStatusText('Все доступные скрины скачаны')
    } catch (err) {
      setStatusText(`Ошибка скачивания всех скринов: ${err.message}`)
    } finally {
      setBulkAction(null)
    }
  }

  const handleDeleteAll = async () => {
    setBulkAction('delete')
    try {
      for (const screenshot of screenshots) {
        await deleteScreenshot(screenshot)
      }
      setStatusText('Все скрины удалены')
    } catch (err) {
      setStatusText(`Ошибка удаления всех скринов: ${err.message}`)
    } finally {
      setBulkAction(null)
    }
  }

  const lightbox = selectedScreenshot ? createPortal(
    <div className="screenshots-lightbox" role="dialog" aria-modal="true">
      <button className="screenshots-lightbox-close" type="button" onClick={() => setSelectedScreenshotId(null)}>×</button>
      <button className="screenshots-lightbox-nav left" type="button" onClick={() => moveViewer(-1)}>‹</button>
      <div className="screenshots-lightbox-content">
        {selectedImageSrc ? (
          <img src={selectedImageSrc} alt="Скриншот экрана" />
        ) : (
          <div className="screenshots-lightbox-empty">Изображение загружается</div>
        )}
        <div className="screenshots-lightbox-meta">
          {selectedScreenshot.source === 'scheduled' ? 'По расписанию' : 'Ручной запрос'} · {formatMeta(selectedScreenshot)}
        </div>
      </div>
      <button className="screenshots-lightbox-nav right" type="button" onClick={() => moveViewer(1)}>›</button>
    </div>,
    document.body
  ) : null

  return (
    <div className="screenshots-panel animate-in">
      <div className="screenshots-card">
        <div className="screenshots-header">
          <div>
            <h2 className="screenshots-title">Скриншоты экрана</h2>
            <p className="screenshots-desc">Ручной скрин доступен раз в 15 секунд. Автоматические скриншоты делаются не чаще одного раза в 60 минут.</p>
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
                min={MIN_SCHEDULED_INTERVAL_MINUTES}
                step="5"
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
        <div className="screenshots-gallery-header">
          <div>
            <h3 className="screenshots-subtitle">Галерея скриншотов</h3>
            <p className="screenshots-desc">Полные изображения хранятся в облаке до 3 дней, затем удаляются автоматически.</p>
          </div>
          {screenshots.length > 0 && (
            <div className="screenshots-actions">
              <button className="btn btn-secondary btn-sm" onClick={handleDownloadAll} disabled={Boolean(bulkAction)}>
                {bulkAction === 'download' ? <span className="btn-spinner-sm" /> : 'Скачать все'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleDeleteAll} disabled={Boolean(bulkAction)}>
                {bulkAction === 'delete' ? <span className="btn-spinner-sm" /> : 'Удалить все'}
              </button>
            </div>
          )}
        </div>

        {screenshots.length === 0 ? (
          <div className="screenshots-empty">Пока нет скриншотов.</div>
        ) : (
          <div className="screenshots-gallery">
            {groupedScreenshots.map(group => (
              <section className="screenshots-day-group" key={group.key}>
                <h4 className="screenshots-day-title">{group.title}</h4>
                <div className="screenshots-thumbs">
                  {group.items.map(screenshot => {
                    const imageSrc = getImageSrc(screenshot)
                    return (
                      <article className="screenshots-thumb-card" key={screenshot.id}>
                        <button className="screenshots-thumb" type="button" onClick={() => openViewer(screenshot)}>
                          {imageSrc ? (
                            <img src={imageSrc} alt="Скриншот экрана" loading="lazy" />
                          ) : (
                            <span>Изображение загружается</span>
                          )}
                          {screenshot.downloadedAt && <span className="screenshots-badge">Скачан</span>}
                        </button>
                        <div className="screenshots-thumb-info">
                          <div>
                            <div className="screenshots-item-title">{screenshot.source === 'scheduled' ? 'По расписанию' : 'Ручной запрос'}</div>
                            <div className="screenshots-item-meta">{formatMeta(screenshot)}</div>
                          </div>
                          <div className="screenshots-item-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(screenshot)} disabled={busyId === screenshot.id}>
                              {busyId === screenshot.id ? <span className="btn-spinner-sm" /> : 'Скачать'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(screenshot)} disabled={busyId === screenshot.id}>
                              Удалить
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {lightbox}
    </div>
  )
}
