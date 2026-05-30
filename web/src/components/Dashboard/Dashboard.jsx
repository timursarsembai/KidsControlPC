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

  return (
    <div className="dashboard">
      <Header onSignOut={onSignOut} />
      <div className="dashboard-body">
        <DeviceSidebar />
        {showSettings
          ? <SettingsPanel />
          : <ContentArea />
        }
        {selectedDeviceId && !showSettings && <NavSidebar />}
      </div>
    </div>
  )
}

