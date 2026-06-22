import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import AccountSection from './AccountSection'
import AppLogsSection from './AppLogsSection'
import AboutSection from './AboutSection'
import DevicesSection from './DevicesSection'
import ParentAccessSection from './ParentAccessSection'
import './SettingsPanel.css'

const TABS = [
  { id: 'devices', label: 'Устройства', icon: '🖥️' },
  { id: 'account', label: 'Аккаунт', icon: '👤' },
  { id: 'parents', label: 'Добавить родителя', icon: '👥' },
  { id: 'logs', label: 'Логи', icon: '📋' },
  { id: 'about', label: 'О приложении', icon: 'ℹ️' }
]

export default function SettingsPanel() {
  const { t } = useTranslation()
  const { user, activeOwnerUid } = useRulesStore()
  const [activeTab, setActiveTab] = useState('devices')

  if (!user) return null

  return (
    <div className="settings-panel animate-in">
      <div className="settings-sidebar">
        <div className="settings-sidebar-title">{t('settings.title', 'Настройки')}</div>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="settings-nav-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === 'devices' && <DevicesSection uid={activeOwnerUid || user.uid} />}
        {activeTab === 'account' && <AccountSection user={user} />}
        {activeTab === 'parents' && <ParentAccessSection user={user} />}
        {activeTab === 'logs' && <AppLogsSection />}
        {activeTab === 'about' && <AboutSection />}
      </div>
    </div>
  )
}
