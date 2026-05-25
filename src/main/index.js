import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { getSystemApps } from './scanner'
import { autoUpdater } from 'electron-updater'

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Check for updates
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch(err => console.error('AutoUpdate check failed:', err))
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── System Scanner ───────────────────────────────────────────────────────────
ipcMain.handle('system:getApps', async () => {
  try {
    console.log('[IPC] system:getApps — starting scan...')
    const apps = await getSystemApps()
    console.log(`[IPC] system:getApps — found ${apps.length} apps`)
    return { success: true, data: apps, count: apps.length }
  } catch (err) {
    console.error('[IPC] system:getApps error:', err)
    return {
      success: false,
      error: err.message || String(err),
      stack: err.stack,
      data: []
    }
  }
})

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── AutoUpdater Events ───────────────────────────────────────────────────────
autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Обновление загружено',
    message: `Доступна новая версия программы (v${info.version}).\\nУстановить и перезапустить прямо сейчас?`,
    buttons: ['Да, установить', 'Позже']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall()
    }
  })
})
