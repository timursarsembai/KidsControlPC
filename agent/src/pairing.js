/**
 * Pairing module
 * Handles first-run setup: links this child PC to a parent Firebase account
 * via a 6-character pairing code generated in the Parent app
 */

import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, query, where,
  getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp
} from 'firebase/firestore'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { firebaseConfig, PAIRING_FILE, AGENT_VERSION } from './config.js'
import { hostname, type as osType } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)
const widgetExe = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'dist', 'CustomDialogWidget.exe')
  : path.join(process.cwd(), 'CustomDialogWidget.exe')

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

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

  const langChoice = await promptUI('Language / Язык', 'Choose language / Выберите язык\n(1 - English, 2 - Русский)', true)
  const isRu = langChoice === '2'

  if (isRu) {
    await promptUI('KidsControlPC', 'Первый запуск — необходима привязка к аккаунту родителя.\nОткройте родительское приложение → Настройки → Устройства\n→ нажмите "Сгенерировать код привязки"', false)
  } else {
    await promptUI('KidsControlPC', 'First run — pairing with parent account required.\nOpen parent app → Settings → Devices\n→ click "Generate pairing code"', false)
  }

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
      // Search all users for this pairing code
      const result = await findPairingCode(normalized, isRu)

      if (!result) {
        await promptUI(isRu ? 'Ошибка' : 'Error', isRu ? 'Код не найден или истёк срок действия (15 минут). Попробуйте ещё раз.' : 'Code not found or expired (15 mins). Try again.', false)
        attempts++
        continue
      }

      const { parentUid, codeDocId } = result
      const deviceId = `device_${Date.now()}`
      const deviceHostname = hostname()

      // Register this device under the parent's account
      await setDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
        hostname: deviceHostname,
        osType: osType(),
        pairedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
        deviceName: hostname(),
        agentVersion: AGENT_VERSION,
        status: 'online'
      })

      // Mark pairing code as used
      await updateDoc(doc(db, 'pairingCodes', codeDocId), {
        used: true,
        usedAt: serverTimestamp(),
        deviceId
      })

      // Save pairing locally
      const pairingData = { parentUid, deviceId, deviceHostname, pairedAt: new Date().toISOString() }
      savePairing(pairingData)

      await promptUI(isRu ? 'Успешно' : 'Success', isRu ? `ПК "${deviceHostname}" привязан к аккаунту родителя.\nАгент запускается в фоновом режиме...` : `PC "${deviceHostname}" paired to parent account.\nAgent starting in background...`, false)

      return pairingData

    } catch (err) {
      console.error('TEST ERROR:', err)
      await promptUI(isRu ? 'Ошибка' : 'Error', isRu ? `Ошибка при проверке кода: ${err.message}` : `Error checking code: ${err.message}`, false)
      attempts++
    }
  }

  throw new Error('Too many failed pairing attempts / Превышено количество попыток')
}

// ─── Search for pairing code directly by document ID ─────────────────────────
async function findPairingCode(code, isRu) {
  try {
    const docRef = doc(db, 'pairingCodes', code)
    const docSnap = await getDoc(docRef)
    if (!docSnap.exists()) return null

    const data = docSnap.data()
    if (data.used) return null

    // Check expiry
    const expiresAt = data.expiresAt instanceof Timestamp
      ? data.expiresAt.toDate()
      : new Date(data.expiresAt)

    if (expiresAt < new Date()) {
      console.log(isRu ? '   (код истёк)' : '   (code expired)')
      return null
    }

    return { parentUid: data.parentUid, codeDocId: code }

  } catch (err) {
    throw new Error(isRu ? `Ошибка поиска кода: ${err.message}` : `Error finding code: ${err.message}`)
  }
}
