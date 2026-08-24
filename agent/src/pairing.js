/**
 * Pairing module
 * Handles first-run setup: links this child PC to a parent Firebase account
 * via a 6-character pairing code generated in the Parent app.
 * Uses the pairDevice Cloud Function for atomic code validation + device creation.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { PAIRING_FILE, AGENT_VERSION, BACKEND, IS_SELF_HOSTED } from './config.js'
import { callCF } from './network/firebaseSync.js'
import { api } from './network/httpClient.js'
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
/**
 * Reads the saved pairing, or null if this machine is not paired.
 *
 * A pairing made against a different backend counts as no pairing at all. Both
 * builds install into the same folder under the same service name and share
 * this file, so installing one over the other leaves the new agent holding
 * credentials the new server has never heard of. It would start, look
 * installed, and enforce nothing — the worst possible way to fail. Better to
 * ask for a code again.
 */
export function loadPairing() {
  if (!existsSync(PAIRING_FILE)) return null
  try {
    const pairing = JSON.parse(readFileSync(PAIRING_FILE, 'utf8'))

    // Older files predate this field; they were all written by the Firebase
    // build, so that is what an absent value means.
    const pairedWith = pairing.backend || 'firebase'
    if (pairedWith !== BACKEND) {
      console.log(
        `[Pairing] This PC is paired with the "${pairedWith}" backend, but this agent talks to "${BACKEND}". ` +
        'Pairing again is required.'
      )
      return null
    }

    return pairing
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

  // No sign-in here on purpose. An anonymous session would be persisted to
  // agent_auth.json and then restored on every later start, permanently shadowing
  // the `agent_<deviceId>` custom-token identity that the security rules expect.
  // pairDevice returns the upload token; initFirebaseSync authenticates with it.

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
      const payload = {
        code: normalized,
        hostname: hostname(),
        osType: osType(),
        agentVersion: AGENT_VERSION
      }

      // Both backends answer with the same three things under different
      // names: who owns this device, which device it is, and the secret it
      // will trade for tokens from now on.
      const result = IS_SELF_HOSTED
        ? await api.post('/agent/pair', payload, { auth: false })
        : await callCF('pairDevice', payload)

      const parentUid = result.parentUid ?? result.ownerId
      const deviceId = result.deviceId
      const deviceSecret = result.deviceSecret ?? result.screenshotUploadToken
      const deviceHostname = hostname()

      const pairingData = {
        // Which backend this pairing belongs to. Read on every start, so an
        // agent installed over one built for the other backend asks for a new
        // code instead of quietly failing to authenticate.
        backend: BACKEND,
        parentUid,
        deviceId,
        // Written under both names so a pairing file survives a build being
        // switched from one backend to the other without a re-pair.
        deviceSecret,
        screenshotUploadToken: deviceSecret,
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
      const msg = /not.found|not found/i.test(err.message)
        ? (isRu ? 'Код не найден или истёк срок действия (15 минут). Попробуйте ещё раз.' : 'Code not found or expired (15 mins). Try again.')
        : /already.exists|already exists/i.test(err.message)
          ? (isRu ? 'Этот код уже был использован.' : 'This code has already been used.')
          : (isRu ? `Ошибка при проверке кода: ${err.message}` : `Error checking code: ${err.message}`)
      await promptUI(isRu ? 'Ошибка' : 'Error', msg, false)
      attempts++
    }
  }

  throw new Error('Too many failed pairing attempts / Превышено количество попыток')
}
