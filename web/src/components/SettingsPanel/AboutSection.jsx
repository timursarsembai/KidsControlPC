import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function AboutSection() {
  const { t, i18n } = useTranslation()
  const { devices } = useRulesStore()
  const hasDevices = devices.length > 0
  const anyOnline = devices.some(d => {
    const lastSeen = d.lastSeen?.toDate?.()
    return lastSeen && (Date.now() - lastSeen.getTime()) < 3 * 60 * 1000
  })

  const handleLanguageChange = (e) => {
    const lang = e.target.value
    i18n.changeLanguage(lang)
    localStorage.setItem('appLanguage', lang)
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">ℹ️</div>
        <div>
          <h2 className="settings-section-title">{t('settings.about.title', 'О приложении')}</h2>
          <p className="settings-section-desc">{t('settings.about.desc', 'Настройки и информация')}</p>
        </div>
      </div>

      <div className="about-grid">
        <div className="about-item">
          <span className="about-label">{t('settings.language', 'Язык (Language)')}</span>
          <select
            className="input"
            style={{ width: '100%', marginTop: 5 }}
            value={i18n.language}
            onChange={handleLanguageChange}
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>

        <div className="about-item">
          <span className="about-label">{t('settings.about.app_label', 'Приложение')}</span>
          <span className="about-value">KidsControlPC</span>
        </div>
        <div className="about-item">
          <span className="about-label">{t('settings.about.status_label', 'Статус агента')}</span>
          <span className="about-value about-status">
            {hasDevices ? (
              anyOnline ? (
                <><span className="status-dot active" /> {t('settings.about.status_online', 'Подключен (Онлайн)')}</>
              ) : (
                <><span className="status-dot inactive" /> {t('settings.about.status_offline', 'Подключен (Оффлайн)')}</>
              )
            ) : (
              <><span className="status-dot inactive" /> {t('settings.about.status_not_installed', 'Не установлен')}</>
            )}
          </span>
        </div>
      </div>
    </section>
  )
}
