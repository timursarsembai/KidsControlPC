const crypto = require('crypto')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { admin, db } = require('./firebaseAdmin')
const { REGION, requireAuth } = require('./config')

const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000  // 15 minutes

const createPairingCode = onCall({ region: REGION }, async (request) => {
  const ownerUid = requireAuth(request)

  let code = ''
  for (let i = 0; i < 6; i++) code += PAIRING_CODE_CHARS[crypto.randomInt(0, PAIRING_CODE_CHARS.length)]

  const now = admin.firestore.Timestamp.now()
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PAIRING_CODE_TTL_MS)
  await db.collection('pairingCodes').doc(code).set({
    parentUid: ownerUid,
    createdAt: now,
    expiresAt,
    used: false
  })

  return { code, expiresAt: expiresAt.toDate().toISOString() }
})

// Generates a pairing code scoped to an already-existing device (identified by
// targetDeviceId in the pairingCodes doc). Lets a parent reinstall/replace a
// child PC without losing that device's rules — pairDevice below writes into
// the existing device doc instead of creating a new one, so anything keyed by
// deviceId (rules, activity history, screenshots, ...) survives untouched.
const createRepairPairingCode = onCall({ region: REGION }, async (request) => {
  const callerUid = requireAuth(request)
  const { ownerUid: rawOwnerUid, deviceId } = request.data || {}
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId is required.')

  const ownerUid = rawOwnerUid || callerUid

  if (callerUid !== ownerUid) {
    const accessSnap = await db.doc(`users/${ownerUid}/parentAccess/${callerUid}`).get()
    if (!accessSnap.exists || accessSnap.data().status !== 'active') {
      throw new HttpsError('permission-denied', 'You do not have access to this device.')
    }
  }

  const deviceSnap = await db.doc(`users/${ownerUid}/devices/${deviceId}`).get()
  if (!deviceSnap.exists) throw new HttpsError('not-found', 'Device not found.')

  let code = ''
  for (let i = 0; i < 6; i++) code += PAIRING_CODE_CHARS[crypto.randomInt(0, PAIRING_CODE_CHARS.length)]

  const now = admin.firestore.Timestamp.now()
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PAIRING_CODE_TTL_MS)
  await db.collection('pairingCodes').doc(code).set({
    parentUid: ownerUid,
    targetDeviceId: deviceId,
    createdAt: now,
    expiresAt,
    used: false
  })

  return { code, expiresAt: expiresAt.toDate().toISOString() }
})

const pairDevice = onCall({ region: REGION }, async (request) => {
  // agentUid may be null when the agent runs in pkg/Node.js (Firebase Auth HTTP fails).
  // registerAgentUid will update it once auth is established on a subsequent start.
  const agentUid = request.auth?.uid ?? null

  const code = String(request.data?.code || '').toUpperCase().replace(/\s/g, '')
  if (code.length !== 6) throw new HttpsError('invalid-argument', 'Code must be exactly 6 characters.')

  const hostname = String(request.data?.hostname || '').slice(0, 100)
  const osType = String(request.data?.osType || '').slice(0, 50)
  const agentVersion = String(request.data?.agentVersion || '').slice(0, 20)

  const codeRef = db.collection('pairingCodes').doc(code)
  const newDeviceId = crypto.randomUUID()

  const { parentUid, deviceId } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Code not found or expired.')
    const data = snap.data()
    if (data.used) throw new HttpsError('already-exists', 'Code has already been used.')
    if (data.expiresAt.toMillis() <= Date.now()) throw new HttpsError('deadline-exceeded', 'Code has expired.')

    const now = admin.firestore.Timestamp.now()

    if (data.targetDeviceId) {
      const deviceRef = db.doc(`users/${data.parentUid}/devices/${data.targetDeviceId}`)
      const deviceSnap = await tx.get(deviceRef)
      if (!deviceSnap.exists) throw new HttpsError('not-found', 'Target device no longer exists.')

      tx.update(codeRef, { used: true, usedAt: now, deviceId: data.targetDeviceId })
      // merge: true — deliberately omits deviceName/alias so a parent's custom
      // device name survives a repair pairing; only connection metadata refreshes.
      tx.set(deviceRef, {
        hostname,
        osType,
        pairedAt: now,
        lastSeen: now,
        agentVersion,
        agentUid,
        status: 'online'
      }, { merge: true })
      return { parentUid: data.parentUid, deviceId: data.targetDeviceId }
    }

    tx.update(codeRef, { used: true, usedAt: now, deviceId: newDeviceId })
    tx.set(db.doc(`users/${data.parentUid}/devices/${newDeviceId}`), {
      hostname,
      osType,
      pairedAt: now,
      lastSeen: now,
      deviceName: hostname,
      agentVersion,
      agentUid,
      status: 'online'
    })
    return { parentUid: data.parentUid, deviceId: newDeviceId }
  })

  return { parentUid, deviceId }
})

const registerAgentUid = onCall({ region: REGION }, async (request) => {
  const agentUid = request.auth?.uid
  if (!agentUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const parentUid = String(request.data?.parentUid || '').trim()
  const deviceId = String(request.data?.deviceId || '').trim()
  if (!parentUid || !deviceId) throw new HttpsError('invalid-argument', 'parentUid and deviceId are required.')

  const deviceRef = db.doc(`users/${parentUid}/devices/${deviceId}`)
  const snap = await deviceRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Device not found.')

  const existing = snap.data()
  // Always allow overwrite — handles reinstall / persistence loss where a new
  // anonymous UID replaces the previous one. Caller must know ownerUid+deviceId.
  if (existing.agentUid !== agentUid) {
    await deviceRef.update({ agentUid })
  }

  return { ok: true }
})

// Issues a Firebase custom token to an agent that proves device ownership via
// screenshotUploadToken (stored in pairing.json and the device doc).
// httpsCallable works over gRPC — no browser fetch needed, works in pkg/Node.js.
const getAgentToken = onCall({ region: REGION }, async (request) => {
  const parentUid = String(request.data?.parentUid || '').trim()
  const deviceId  = String(request.data?.deviceId  || '').trim()
  const uploadToken = String(request.data?.uploadToken || '').trim()
  if (!parentUid || !deviceId || !uploadToken) {
    throw new HttpsError('invalid-argument', 'parentUid, deviceId, uploadToken are required.')
  }

  const snap = await db.doc(`users/${parentUid}/devices/${deviceId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Device not found.')

  const stored = snap.data().screenshotUploadToken
  if (!stored || stored !== uploadToken) {
    throw new HttpsError('permission-denied', 'Invalid upload token.')
  }

  const uid = `agent_${deviceId}`
  const token = await admin.auth().createCustomToken(uid, { deviceId, parentUid })
  return { token }
})

module.exports = { createPairingCode, createRepairPairingCode, pairDevice, registerAgentUid, getAgentToken }
