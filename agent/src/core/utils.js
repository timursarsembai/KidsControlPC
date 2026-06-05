import { exec } from 'child_process'

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function execAsync(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        return reject(error)
      }
      resolve({ stdout, stderr })
    })
  })
}

export async function runEncodedPS(script, timeoutMs = 15000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return execAsync(
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    { timeout: timeoutMs, windowsHide: true }
  )
}

export async function getSessionIdsForProcess(processName) {
  const sessions = new Set()
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`, { timeout: 3000, windowsHide: true })
    const lines = stdout.trim().split('\n')
    for (const line of lines) {
      if (line.toLowerCase().includes(processName.toLowerCase())) {
        const parts = line.split('","')
        if (parts.length >= 4) {
          const sid = parts[3].replace(/[^0-9]/g, '')
          if (sid) sessions.add(parseInt(sid, 10))
        }
      }
    }
  } catch { }
  return sessions
}
