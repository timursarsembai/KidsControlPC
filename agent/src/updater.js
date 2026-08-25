import { IS_SELF_HOSTED } from './config.js'
import https from 'https'
import fs from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { AGENT_VERSION } from './config.js'

export async function checkAndUpdateSilently(logFunc = console.log, force = false) {
  try {
    const url = 'https://api.github.com/repos/timursarsembai/KidsControlPC/releases/latest'
    const release = await fetchJson(url)
    
    if (!release || !release.tag_name) return

    const latestVersion = release.tag_name.replace('v', '')
    if (force || isNewerVersion(AGENT_VERSION, latestVersion)) {
      logFunc(`[Updater] Найден релиз: v${latestVersion}. Текущая версия: v${AGENT_VERSION}${force ? ' (Принудительное обновление)' : ''}`)
      
      // Своя сборка, а не первая попавшаяся: в релизе лежат обе, и чужая
      // увела бы агента на другой сервер.
      const assetName = IS_SELF_HOSTED
        ? 'KidsControlAgent_SelfHosted_Setup.exe'
        : 'KidsControlAgent_Setup.exe'
      const asset = release.assets.find(a => a.name === assetName)
      if (!asset) logFunc(`[Updater] В релизе нет файла ${assetName} — обновление пропущено`)
      if (asset) {
        logFunc(`[Updater] Скачивание обновления...`)
        const setupPath = join(tmpdir(), `kca_setup_v${latestVersion}.exe`)
        await downloadFile(asset.browser_download_url, setupPath)
        
        logFunc(`[Updater] Обновление скачано. Запуск тихой установки и перезапуск службы...`)
        
        // Run the installer silently and detached
        const child = spawn(setupPath, ['/S'], {
          detached: true,
          stdio: 'ignore'
        })
        child.on('error', err => {
          logFunc(`[Updater] Installer start error: ${err.message}`)
        })
        child.unref()
        
        // Do not exit immediately here. The installer stops/reinstalls/starts the
        // service itself; exiting first can leave the agent offline if the installer
        // fails before the service restart step.
      }
    }
  } catch (err) {
    logFunc(`[Updater] Ошибка при проверке обновлений: ${err.message}`)
  }
}

function isNewerVersion(current, latest) {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const vc = c[i] || 0
    const vl = l[i] || 0
    if (vl > vc) return true
    if (vl < vc) return false
  }
  return false
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'KidsControlPC-Agent' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`))
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'KidsControlPC-Agent' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`))
      }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', reject)
  })
}
