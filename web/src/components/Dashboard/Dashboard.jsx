import React from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ContentArea from '../ContentArea/ContentArea'
import SettingsPanel from '../SettingsPanel/SettingsPanel'
import Header from '../Header/Header'
import NavSidebar from '../NavSidebar/NavSidebar'
import DeviceSidebar from '../DeviceSidebar/DeviceSidebar'
import './Dashboard.css'

export default function Dashboard({ onSignOut }) {
  const { showSettings, selectedDeviceId } = useRulesStore()
  const [mobileDevicesOpen, setMobileDevicesOpen] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  const closeMobilePanels = React.useCallback(() => {
    setMobileDevicesOpen(false)
    setMobileNavOpen(false)
  }, [])

  React.useEffect(() => {
    closeMobilePanels()
  }, [showSettings, selectedDeviceId, closeMobilePanels])

  return (
    <div className="dashboard">
      <Header
        onOpenDevices={() => setMobileDevicesOpen(true)}
        onOpenSections={() => setMobileNavOpen(true)}
        onSignOut={onSignOut}
        showSectionsButton={Boolean(selectedDeviceId && !showSettings)}
      />
      <div className="dashboard-body">
        <button
          aria-label="Закрыть меню"
          className={`dashboard-mobile-scrim ${mobileDevicesOpen || mobileNavOpen ? 'visible' : ''}`}
          onClick={closeMobilePanels}
          type="button"
        />
        <DeviceSidebar
          isMobileOpen={mobileDevicesOpen}
          onMobileNavigate={closeMobilePanels}
        />
        {showSettings
          ? <SettingsPanel />
          : <ContentArea />
        }
        {selectedDeviceId && !showSettings && (
          <NavSidebar
            isMobileOpen={mobileNavOpen}
            onMobileNavigate={closeMobilePanels}
          />
        )}
      </div>
    </div>
  )
}

