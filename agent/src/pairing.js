/**
 * Pairing module
 * Handles first-run setup: links this child PC to a parent Firebase account
 * via a 6-character pairing code generated in the Parent app.
 * Uses the pairDevice Cloud Function for atomic code validation + device creation.
 */

import { httpsCallable } from 'firebase/functions'
import { signInAnonymously } from 'firebase/auth'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { PAIRING_FILE, AGENT_VERSION } from './config.js'
import { auth, functions } from './network/firebaseSync.js'
import { hostname, type as osType } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)
const widgetExe = process.env.NODE_ENV === 'development'
  ? path.join(process.cwd(), 'dist', 'CustomDialogWidget.exe')
  : path.join(process.cwd(), 'CustomDialogWidget.exe')

// ─── Prompt helper ────────────────────────────────────────────────────────────
async function promptUI(title, message, requireInput) {
  try {
    const titleB64 = Buffer.from(title, 'utf8').toString('base64')
    const msgB64 = Buffer.from(message, 'utf8').toString('base64')
    const reqInp = requireInput ? '1' : '0'
    const { stdout } = await execFileAsync(widgetExe, [titleB64, msgB64, reqInp])
    return stdout.trim()
  } catch (err) {
    console.error('Prompt error:', err)
    return ''
  }
}

// ─── Load saved pairing ───────────────────────────────────────────────────────
export function loadPairing() {
  if (!existsSync(PAIRING_FILE)) return null
  try {
    return JSON.parse(readFileSync(PAIRING_FILE, 'utf8'))
  } catch {
    return null
  }
}

// ─── Save pairing to disk ─────────────────────────────────────────────────────
function savePairing(data) {
  writeFileSync(PAIRING_FILE, JSON.stringify(data, null, 2), 'utf8')
}

// ─── First-run pairing flow ───────────────────────────────────────────────────
export async function runPairingFlow() {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║     KidsControlPC — Agent (Child PC)     ║')
  console.log('╚══════════════════════════════════════════╝\n')

  // Sign in anonymously first — agentUid will be stored in the device doc by pairDevice CF.
  if (!auth.currentUser) {
    await signInAnonymously(auth)
    console.log(`[Pairing] Anonymous auth established: ${auth.currentUser.uid}`)
  }

  const langChoice = await promptUI('Language / Язык', 'Choose language / Выберите язык\n(1 - English, 2 - Русский)', true)
  const isRu = langChoice === '2'

  if (isRu) {
    await promptUI('KidsControlPC', 'Первый запуск — необходима привязка к аккаунту родителя.\nОткройте родительское приложение → Настройки → Устройства\n→ нажмите "Сгенерировать код привязки"', false)
  } else {
    await promptUI('KidsControlPC', 'First run — pairing with parent account required.\nOpen parent app → Settings → Devices\n→ click "Generate pairing code"', false)
  }

  const pairDeviceFn = httpsCallable(functions, 'pairDevice')
  let attempts = 0

  while (attempts < 3) {
    const code = await promptUI(isRu ? 'Привязка' : 'Pairing', isRu ? 'Введите 6-символьный код:' : 'Enter 6-character code:', true)

    if (code === 'CANCEL' || !code) {
      throw new Error('Pairing cancelled')
    }

    const normalized = code.toUpperCase().replace(/\s/g, '')

    if (normalized.length !== 6) {
      await promptUI(isRu ? 'Ошибка' : 'Error', isRu ? 'Код должен быть ровно 6 символов. Попробуйте ещё раз.' : 'Code must be exactly 6 characters. Try again.', false)
      attempts++
      continue
    }

    console.log(isRu ? '\n⏳ Проверяю код...' : '\n⏳ Checking code...')

    try {
      const result = await pairDeviceFn({
        code: normalized,
        hostname: hostname(),
        osType: osType(),
        agentVersion: AGENT_VERSION
      })

      const { parentUid, deviceId } = result.data
      const deviceHostname = hostname()

      const pairingData = {
        parentUid,
        deviceId,
        agentUid: auth.currentUser.uid,
        deviceHostname,
        pairedAt: new Date().toISOString()
      }
      savePairing(pairingData)

      await promptUI(
        isRu ? 'Успешно' : 'Success',
        isRu
          ? `ПК "${deviceHostname}" привязан к аккаунту родителя.\nАгент запускается в фоновом режиме...`
          : `PC "${deviceHostname}" paired to parent account.\nAgent starting in background...`,
        false
      )

      return pairingData

    } catch (err) {
      console.error('Pairing error:', err)
      const msg = err.code === 'functions/not-found'
        ? (isRu ? 'Код не найден или истёк срок действия (15 минут). Попробуйте ещё раз.' : 'Code not found or expired (15 mins). Try again.')
        : err.code === 'functions/already-exists'
          ? (isRu ? 'Этот код уже был использован.' : 'This code has already been used.')
          : (isRu ? `Ошибка при проверке кода: ${err.message}` : `Error checking code: ${err.message}`)
      await promptUI(isRu ? 'Ошибка' : 'Error', msg, false)
      attempts++
    }
  }

  throw new Error('Too many failed pairing attempts / Превышено количество попыток')
}
