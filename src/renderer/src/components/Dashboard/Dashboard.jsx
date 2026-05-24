import React from 'react'
import { useRulesStore } from '../../stores/useRulesStore'
import ContentArea from '../ContentArea/ContentArea'
import SettingsPanel from '../SettingsPanel/SettingsPanel'
import TitleBar from '../TitleBar/TitleBar'
import Sidebar from '../Sidebar/Sidebar'
import './Dashboard.css'

export default function Dashboard({ onSignOut }) {
  const { showSettings } = useRulesStore()

  return (
    <div className="dashboard">
      <TitleBar onSignOut={onSignOut} />
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
