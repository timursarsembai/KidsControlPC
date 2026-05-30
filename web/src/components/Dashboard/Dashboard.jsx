import React from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ContentArea from '../ContentArea/ContentArea'
import SettingsPanel from '../SettingsPanel/SettingsPanel'
import Header from '../Header/Header'
import Sidebar from '../Sidebar/Sidebar'
import './Dashboard.css'

export default function Dashboard({ onSignOut }) {
  const { showSettings } = useRulesStore()

  return (
    <div className="dashboard">
      <Header onSignOut={onSignOut} />
      <div className="dashboard-body">
        <Sidebar />
        {showSettings
          ? <SettingsPanel />
          : <ContentArea />
        }
      </div>
    </div>
  )
}

