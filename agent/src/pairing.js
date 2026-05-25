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
import { firebaseConfig, PAIRING_FILE } from './config.js'
import { hostname, type as osType } from 'os'
import { createInterface } from 'readline'

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

// ─── Prompt helper ────────────────────────────────────────────────────────────
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
  })
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

  const langChoice = await prompt('Choose language / Выберите язык (1 - English, 2 - Русский) [1]: ')
  const isRu = langChoice.trim() === '2'

  if (isRu) {
    console.log('\n🔗 Первый запуск — необходима привязка к аккаунту родителя.')
    console.log('   Откройте родительское приложение → Настройки → Устройства')
    console.log('   → нажмите "Сгенерировать код привязки"\n')
  } else {
    console.log('\n🔗 First run — pairing with parent account required.')
    console.log('   Open parent app → Settings → Devices')
    console.log('   → click "Generate pairing code"\n')
  }

  let attempts = 0
  while (attempts < 3) {
    const code = await prompt(isRu ? 'Введите 6-символьный код: ' : 'Enter 6-character code: ')
    const normalized = code.toUpperCase().replace(/\s/g, '')

    if (normalized.length !== 6) {
      console.log(isRu ? '❌ Код должен быть ровно 6 символов. Попробуйте ещё раз.\n' : '❌ Code must be exactly 6 characters. Try again.\n')
      attempts++
      continue
    }

    console.log(isRu ? '\n⏳ Проверяю код...' : '\n⏳ Checking code...')

    try {
      // Search all users for this pairing code
      const result = await findPairingCode(normalized, isRu)

      if (!result) {
        console.log(isRu ? '❌ Код не найден или истёк срок действия (15 минут). Попробуйте ещё раз.\n' : '❌ Code not found or expired (15 mins). Try again.\n')
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
        status: 'online',
        agentVersion: '1.0.0'
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

      console.log(isRu ? `\n✅ Привязка успешна!` : `\n✅ Pairing successful!`)
      console.log(isRu ? `   ПК "${deviceHostname}" привязан к аккаунту родителя.` : `   PC "${deviceHostname}" paired to parent account.`)
      console.log(isRu ? '   Агент запускается в фоновом режиме...\n' : '   Agent starting in background...\n')

      return pairingData

    } catch (err) {
      console.error(isRu ? '❌ Ошибка при проверке кода:' : '❌ Error checking code:', err.message)
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
