import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import '@kidscontrol/shared/i18n'
import { logger } from './core/logger'

logger.info('general', 'Родительское приложение (Web UI) запущено')
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

