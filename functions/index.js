const crypto = require('crypto')
const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onObjectFinalized, onObjectDeleted } = require('firebase-functions/v2/storage')
const nodemailer = require('nodemailer')

admin.initializeApp()

const db = admin.firestore()
const auth = admin.auth()

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000
const REGION = process.env.FUNCTIONS_REGION || 'us-central1'
// Storage triggers must be deployed in the same region as the bucket.
const STORAGE_REGION = process.env.FUNCTIONS_STORAGE_REGION || 'us-east1'
const ATTACHMENT_RE = /^users\/([^/]+)\/chats\/([^/]+)\/attachments\/(.+)$/
const SCREENSHOT_RE = /^users\/([^/]+)\/devices\/([^/]+)\/screenshots\/(.+)$/
const FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000   // 7 дней
const DEFAULT_QUOTA = 100 * 1024 * 1024             // 100 МБ (Free план)
const PURGE_THRESHOLD = 0.9                         // 90% — начать принудительную очистку
const PURGE_TARGET = 0.7                            // освободить до 70% заполненности

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Enter a valid parent email.')
  }
  return normalized
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  return request.auth.uid
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+='
  let password = ''
  for (let i = 0; i < length; i += 1) {
    password += alphabet[crypto.randomInt(0, alphabet.length)]
  }
  return password
}

function getAppBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '')
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  return projectId.endsWith('-dev')
    ? 'https://kidscontrolpc-dev.web.app'
    : 'https://kidscontrolpc.web.app'
}

function getMailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new HttpsError(
      'failed-precondition',
      'Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM for Cloud Functions.'
    )
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatInvitationExpiry(date) {
  return date.toLocaleString('ru-RU', {
    timeZone: process.env.MAIL_TIMEZONE || 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function invitationRefs(invitationId, ownerUid) {
  return {
    rootRef: db.collection('parentInvitations').doc(invitationId),
    ownerRef: db.collection('users').doc(ownerUid).collection('parentInvitations').doc(invitationId)
  }
}

async function assertPrimaryOwner(ownerUid) {
  const profileSnap = await db.collection('users').doc(ownerUid).collection('profile').doc('data').get()
  const profile = profileSnap.exists ? profileSnap.data() : {}
  if (profile.ownerUid && profile.ownerUid !== ownerUid) {
    throw new HttpsError('permission-denied', 'Only the primary parent can invite other parents.')
  }
}

async function getUserByEmailOrNull(email) {
  try {
    return await auth.getUserByEmail(email)
  } catch (error) {
    if (error.code === 'auth/user-not-found') return null
    throw error
  }
}

async function assertNoActiveOrPendingInvite(ownerUid, email, invitedUserUid) {
  if (invitedUserUid) {
    const accessSnap = await db.collection('users').doc(ownerUid).collection('parentAccess').doc(invitedUserUid).get()
    if (accessSnap.exists && accessSnap.data().status === 'active') {
      throw new HttpsError('already-exists', 'This parent already has access.')
    }
  }

  const pending = await db.collection('users').doc(ownerUid).collection('parentInvitations')
    .where('email', '==', email)
    .get()

  if (pending.docs.some(doc => doc.data().status === 'pending')) {
    throw new HttpsError('already-exists', 'There is already a pending invitation for this email.')
  }
}

async function sendInvitationEmail({ email, ownerEmail, link, temporaryPassword, expiresAt }) {
  const transport = getMailTransport()
  const from = process.env.MAIL_FROM || process.env.SMTP_USER
  const safeOwnerEmail = escapeHtml(ownerEmail || 'Родитель KidsControlPC')
  const safeEmail = escapeHtml(email)
  const safeLink = escapeHtml(link)
  const safePassword = escapeHtml(temporaryPassword)
  const expiresAtText = formatInvitationExpiry(expiresAt)
  const passwordBlock = temporaryPassword
    ? `\nВременный пароль: ${temporaryPassword}\nИспользуйте его только для принятия приглашения. После подтверждения приложение попросит задать новый пароль.\n`
    : '\nИспользуйте ваш текущий пароль KidsControlPC, чтобы принять приглашение.\n'

  const passwordHtml = temporaryPassword
    ? `
      <div style="margin:24px 0;padding:18px 20px;border-radius:14px;background:#111827;border:1px solid #5b6cff;">
        <div style="margin:0 0 10px;color:#aeb7ff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Временный пароль</div>
        <div style="font-family:Consolas,Menlo,Monaco,monospace;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:.08em;color:#ffffff;word-break:break-all;">${safePassword}</div>
      </div>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">Используйте этот пароль только для принятия приглашения. После подтверждения приложение попросит задать новый пароль.</p>
    `
    : `
      <div style="margin:24px 0;padding:16px 18px;border-radius:14px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.6;">
        Используйте ваш текущий пароль KidsControlPC, чтобы принять приглашение.
      </div>
    `

  const html = `
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Приглашение KidsControlPC</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">${safeOwnerEmail} приглашает вас управлять устройствами семьи в KidsControlPC.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e6e9f2;box-shadow:0 18px 45px rgba(15,23,42,.08);">
            <tr>
              <td style="padding:28px 28px 18px;background:#111827;">
                <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.02em;">KidsControl<span style="display:inline-block;margin-left:5px;padding:2px 7px;border-radius:999px;background:#635bff;color:#ffffff;font-size:12px;vertical-align:middle;">PC</span></div>
                <div style="margin-top:8px;color:#c7d2fe;font-size:14px;">Приглашение родителя</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 14px;color:#111827;font-size:24px;line-height:1.25;">Вас пригласили в KidsControlPC</h1>
                <p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.6;">${safeOwnerEmail} приглашает вас управлять устройствами семьи.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;">
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
                      <div style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Владелец</div>
                      <div style="margin-top:5px;color:#111827;font-size:15px;font-weight:700;word-break:break-word;">${safeOwnerEmail}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Ваш email</div>
                      <div style="margin-top:5px;color:#111827;font-size:15px;font-weight:700;word-break:break-word;">${safeEmail}</div>
                    </td>
                  </tr>
                </table>

                ${passwordHtml}

                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:12px;background:#635bff;">
                      <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;">Открыть приглашение</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.6;">Приглашение действует до ${escapeHtml(expiresAtText)}. Если вы не примете его, приглашение и временный аккаунт будут удалены автоматически.</p>
                <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">Если кнопка не открывается, скопируйте ссылку в браузер:<br><a href="${safeLink}" style="color:#4f46e5;word-break:break-all;">${safeLink}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`

  await transport.sendMail({
    from,
    to: email,
    subject: 'Приглашение родителя в KidsControlPC',
    text: [
      `${ownerEmail || 'Родитель KidsControlPC'} приглашает вас управлять устройствами семьи в KidsControlPC.`,
      '',
      `Откройте ссылку, чтобы принять или отклонить приглашение: ${link}`,
      passwordBlock,
      `Приглашение действует до ${expiresAtText}. Если вы не примете его, приглашение и временный аккаунт будут удалены автоматически.`,
      '',
      'Если вы не ожидали это приглашение, проигнорируйте письмо или отклоните приглашение по ссылке.'
    ].join('\n'),
    html
  })
}

async function readInvitationByToken(invitationId, token) {
  const snap = await db.collection('parentInvitations').doc(String(invitationId || '')).get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Invitation was not found.')
  }

  const invitation = snap.data()
  if (invitation.tokenHash !== tokenHash(String(token || ''))) {
    throw new HttpsError('permission-denied', 'Invitation token is invalid.')
  }

  return { invitation, ref: snap.ref }
}

exports.createParentInvitation = onCall({ region: REGION, secrets: ['SMTP_PASS'] }, async (request) => {
  const ownerUid = requireAuth(request)
  const email = normalizeEmail(request.data?.email)
  const ownerRecord = await auth.getUser(ownerUid)

  if (ownerRecord.email?.toLowerCase() === email) {
    throw new HttpsError('invalid-argument', 'You cannot invite your own email.')
  }

  await assertPrimaryOwner(ownerUid)
  getMailTransport()

  let invitedRecord = await getUserByEmailOrNull(email)
  const accountCreated = !invitedRecord
  const temporaryPassword = accountCreated ? generatePassword() : null

  await assertNoActiveOrPendingInvite(ownerUid, email, invitedRecord?.uid)

  if (accountCreated) {
    invitedRecord = await auth.createUser({
      email,
      password: temporaryPassword,
      emailVerified: false,
      disabled: false
    })
  }

  const invitationId = db.collection('parentInvitations').doc().id
  const token = generateToken()
  const now = admin.firestore.Timestamp.now()
  const expiresAtDate = new Date(Date.now() + INVITATION_TTL_MS)
  const expiresAt = admin.firestore.Timestamp.fromDate(expiresAtDate)
  const link = `${getAppBaseUrl()}/invite?invitationId=${encodeURIComponent(invitationId)}&token=${encodeURIComponent(token)}`
  const payload = {
    ownerUid,
    ownerEmail: ownerRecord.email || null,
    invitedUserUid: invitedRecord.uid,
    email,
    status: 'pending',
    accountCreated,
    tokenHash: tokenHash(token),
    createdAt: now,
    expiresAt,
    cleanupAt: expiresAt,
    createdByUid: ownerUid
  }
  const { rootRef, ownerRef } = invitationRefs(invitationId, ownerUid)

  await db.runTransaction(async (transaction) => {
    transaction.set(rootRef, payload)
    transaction.set(ownerRef, payload)
  })

  try {
    await sendInvitationEmail({
      email,
      ownerEmail: ownerRecord.email,
      link,
      temporaryPassword,
      expiresAt: expiresAtDate
    })
  } catch (error) {
    await Promise.allSettled([rootRef.delete(), ownerRef.delete()])
    if (accountCreated) await auth.deleteUser(invitedRecord.uid).catch(() => {})
    logger.error('Failed to send parent invitation email', {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode
    })
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      throw new HttpsError('failed-precondition', 'SMTP authentication failed. Check the Gmail app password and SMTP_USER.')
    }
    throw new HttpsError('internal', 'Failed to send invitation email. Check SMTP settings and try again.')
  }

  return {
    invitationId,
    email,
    accountCreated,
    expiresAt: expiresAtDate.toISOString()
  }
})

exports.getParentInvitation = onCall({ region: REGION }, async (request) => {
  const { invitation } = await readInvitationByToken(request.data?.invitationId, request.data?.token)

  return {
    email: invitation.email,
    ownerEmail: invitation.ownerEmail,
    status: invitation.status,
    accountCreated: invitation.accountCreated,
    expiresAt: invitation.expiresAt.toDate().toISOString()
  }
})

exports.acceptParentInvitation = onCall({ region: REGION }, async (request) => {
  const parentUid = requireAuth(request)
  const { invitation } = await readInvitationByToken(request.data?.invitationId, request.data?.token)

  if (invitation.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Invitation is not pending.')
  }
  if (invitation.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Invitation has expired.')
  }
  if (invitation.invitedUserUid !== parentUid) {
    throw new HttpsError('permission-denied', 'Sign in with the invited parent account.')
  }

  const now = admin.firestore.Timestamp.now()
  const { rootRef, ownerRef } = invitationRefs(request.data.invitationId, invitation.ownerUid)
  const accessRef = db.collection('users').doc(invitation.ownerUid).collection('parentAccess').doc(parentUid)
  const profileRef = db.collection('users').doc(parentUid).collection('profile').doc('data')

  await db.runTransaction(async (transaction) => {
    transaction.set(accessRef, {
      email: invitation.email,
      role: 'parent',
      status: 'active',
      ownerUid: invitation.ownerUid,
      acceptedAt: now,
      invitedByUid: invitation.createdByUid || invitation.ownerUid
    }, { merge: true })
    transaction.set(profileRef, {
      email: invitation.email,
      role: 'parent',
      ownerUid: invitation.ownerUid,
      plan: 'free',
      inviteAcceptedAt: now
    }, { merge: true })
    transaction.update(rootRef, { status: 'accepted', acceptedAt: now, cleanupAt: null })
    transaction.update(ownerRef, { status: 'accepted', acceptedAt: now, cleanupAt: null })
  })

  return { ownerUid: invitation.ownerUid, requiresPasswordChange: invitation.accountCreated }
})

exports.declineParentInvitation = onCall({ region: REGION }, async (request) => {
  const { invitation } = await readInvitationByToken(request.data?.invitationId, request.data?.token)
  if (invitation.status !== 'pending') {
    return { status: invitation.status }
  }

  const now = admin.firestore.Timestamp.now()
  const cleanupAt = admin.firestore.Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS)
  const updates = { status: 'declined', declinedAt: now, cleanupAt }
  const { rootRef, ownerRef } = invitationRefs(request.data.invitationId, invitation.ownerUid)

  await db.runTransaction(async (transaction) => {
    transaction.update(rootRef, updates)
    transaction.update(ownerRef, updates)
  })

  if (invitation.accountCreated) {
    await auth.updateUser(invitation.invitedUserUid, { disabled: true }).catch((error) => {
      logger.warn('Failed to disable declined temporary parent account', error)
    })
  }

  return { status: 'declined', cleanupAt: cleanupAt.toDate().toISOString() }
})

exports.revokeParentAccess = onCall({ region: REGION }, async (request) => {
  const ownerUid = requireAuth(request)
  const parentUid = String(request.data?.parentUid || '').trim()

  if (!parentUid) {
    throw new HttpsError('invalid-argument', 'Parent uid is required.')
  }
  if (parentUid === ownerUid) {
    throw new HttpsError('invalid-argument', 'You cannot remove your own owner access.')
  }

  await assertPrimaryOwner(ownerUid)

  const accessRef = db.collection('users').doc(ownerUid).collection('parentAccess').doc(parentUid)
  const profileRef = db.collection('users').doc(parentUid).collection('profile').doc('data')
  const now = admin.firestore.Timestamp.now()

  await db.runTransaction(async (transaction) => {
    const accessSnap = await transaction.get(accessRef)
    if (!accessSnap.exists || accessSnap.data().status !== 'active') {
      throw new HttpsError('not-found', 'Parent access was not found.')
    }

    transaction.delete(accessRef)
    transaction.set(profileRef, {
      ownerUid: parentUid,
      role: 'owner',
      accessRevokedAt: now,
      revokedByUid: ownerUid
    }, { merge: true })
  })

  return { parentUid, status: 'revoked' }
})

// ── Storage quota tracking ─────────────────────────────────────────────────────

function profileRef(ownerUid) {
  return db.collection('users').doc(ownerUid).collection('profile').doc('data')
}

async function markMessageFileDeleted(ownerUid, chatId, storagePath) {
  try {
    const snap = await db
      .collection('users').doc(ownerUid)
      .collection('chats').doc(chatId)
      .collection('messages')
      .where('storagePath', '==', storagePath)
      .limit(1)
      .get()
    if (!snap.empty) {
      await snap.docs[0].ref.update({ fileDeleted: true })
    }
  } catch (e) {
    logger.warn('markMessageFileDeleted error', { ownerUid, chatId, storagePath, error: e.message })
  }
}

// Delete oldest attachment files for an owner until usage drops to PURGE_TARGET.
async function purgeOldestFiles(ownerUid, usedBytes, quotaBytes) {
  const bucket = admin.storage().bucket()
  const [files] = await bucket.getFiles({ prefix: `users/${ownerUid}/chats/` })
  const attachments = files
    .filter(f => ATTACHMENT_RE.test(f.name))
    .sort((a, b) => new Date(a.metadata.timeCreated) - new Date(b.metadata.timeCreated))

  const targetBytes = quotaBytes * PURGE_TARGET
  let freed = 0
  for (const file of attachments) {
    if (usedBytes - freed <= targetBytes) break
    const size = Number(file.metadata.size || 0)
    const match = file.name.match(ATTACHMENT_RE)
    if (match) {
      const [, uid, chatId] = match
      await file.delete().catch(() => {})
      await markMessageFileDeleted(uid, chatId, file.name)
      freed += size
      logger.info('purgeOldestFiles deleted', { file: file.name, size })
    }
  }
}

exports.onChatFileUploaded = onObjectFinalized({ region: STORAGE_REGION }, async (event) => {
  const objectName = event.data.name
  const attachMatch = objectName?.match(ATTACHMENT_RE)
  const ssMatch = objectName?.match(SCREENSHOT_RE)
  if (!attachMatch && !ssMatch) return

  const ownerUid = (attachMatch || ssMatch)[1]
  const size = Number(event.data.size || 0)
  const ref = profileRef(ownerUid)

  await ref.set(
    { storageUsedBytes: admin.firestore.FieldValue.increment(size) },
    { merge: true }
  )

  const snap = await ref.get()
  const data = snap.data() || {}
  const used = data.storageUsedBytes || 0
  const quota = data.storageQuotaBytes || DEFAULT_QUOTA

  if (used / quota >= PURGE_THRESHOLD) {
    logger.info('onChatFileUploaded: quota threshold exceeded, purging', { ownerUid, used, quota })
    await purgeOldestFiles(ownerUid, used, quota)
  }
})

exports.onChatFileDeleted = onObjectDeleted({ region: STORAGE_REGION }, async (event) => {
  const objectName = event.data.name
  const attachMatch = objectName?.match(ATTACHMENT_RE)
  const ssMatch = objectName?.match(SCREENSHOT_RE)
  if (!attachMatch && !ssMatch) return

  const ownerUid = (attachMatch || ssMatch)[1]
  const size = Number(event.data.size || 0)
  const ref = profileRef(ownerUid)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.data()?.storageUsedBytes || 0
    tx.set(ref, { storageUsedBytes: Math.max(0, current - size) }, { merge: true })
  })

  if (attachMatch) {
    await markMessageFileDeleted(ownerUid, attachMatch[2], objectName)
  }
})

// Scheduled cleanup: delete attachments older than 7 days for all users.
exports.cleanupOldChatFiles = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const bucket = admin.storage().bucket()
  const cutoff = Date.now() - FILE_MAX_AGE_MS
  const [files] = await bucket.getFiles({ prefix: 'users/' })

  for (const file of files) {
    if (!ATTACHMENT_RE.test(file.name)) continue
    const created = new Date(file.metadata.timeCreated).getTime()
    if (created > cutoff) continue

    const match = file.name.match(ATTACHMENT_RE)
    if (!match) continue
    const [, ownerUid, chatId] = match

    logger.info('cleanupOldChatFiles deleting', { file: file.name })
    await file.delete().catch(() => {})
    await markMessageFileDeleted(ownerUid, chatId, file.name)
  }
})

// Hourly recalculation of storageUsedBytes from real Storage contents.
exports.recalcStorageUsed = onSchedule({ region: REGION, schedule: 'every 60 minutes' }, async () => {
  const bucket = admin.storage().bucket()
  const [files] = await bucket.getFiles({ prefix: 'users/' })

  const totals = {}
  for (const file of files) {
    const m = file.name.match(ATTACHMENT_RE) || file.name.match(SCREENSHOT_RE)
    if (!m) continue
    const uid = m[1]
    const size = Number(file.metadata.size || 0)
    totals[uid] = (totals[uid] || 0) + size
  }

  for (const [uid, bytes] of Object.entries(totals)) {
    await profileRef(uid).set({ storageUsedBytes: bytes }, { merge: true })
  }

  // Zero out users with no files but a non-zero counter
  // (files deleted outside of triggers). Skip — expensive, not worth it.
  logger.info('recalcStorageUsed done', { users: Object.keys(totals).length })
})

// ── Parent invitations ─────────────────────────────────────────────────────────

exports.cleanupExpiredParentInvitations = onSchedule({ region: REGION, schedule: 'every 6 hours' }, async () => {
  const now = admin.firestore.Timestamp.now()

  // Delete expired/declined invitations
  const snap = await db.collection('parentInvitations')
    .where('cleanupAt', '<=', now)
    .limit(100)
    .get()

  await Promise.all(snap.docs.map(async (docSnap) => {
    const invitation = docSnap.data()
    if (invitation.status === 'accepted') return

    const { ownerRef } = invitationRefs(docSnap.id, invitation.ownerUid)
    await Promise.allSettled([docSnap.ref.delete(), ownerRef.delete()])

    if (invitation.accountCreated && invitation.invitedUserUid) {
      await auth.deleteUser(invitation.invitedUserUid).catch((error) => {
        if (error.code !== 'auth/user-not-found') {
          logger.warn('Failed to delete expired temporary parent account', { uid: invitation.invitedUserUid, error })
        }
      })
    }
  }))

  // Also clean up accepted invitation docs older than 90 days (housekeeping)
  const cutoff90 = admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const oldAccepted = await db.collection('parentInvitations')
    .where('status', '==', 'accepted')
    .where('acceptedAt', '<=', cutoff90)
    .limit(100)
    .get()

  await Promise.all(oldAccepted.docs.map(async (docSnap) => {
    const { ownerRef } = invitationRefs(docSnap.id, docSnap.data().ownerUid)
    await Promise.allSettled([docSnap.ref.delete(), ownerRef.delete()])
  }))
})

// ── Pairing ───────────────────────────────────────────────────────────────────

const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000  // 15 minutes

exports.createPairingCode = onCall({ region: REGION }, async (request) => {
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

exports.pairDevice = onCall({ region: REGION }, async (request) => {
  const agentUid = request.auth?.uid
  if (!agentUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const code = String(request.data?.code || '').toUpperCase().replace(/\s/g, '')
  if (code.length !== 6) throw new HttpsError('invalid-argument', 'Code must be exactly 6 characters.')

  const hostname = String(request.data?.hostname || '').slice(0, 100)
  const osType = String(request.data?.osType || '').slice(0, 50)
  const agentVersion = String(request.data?.agentVersion || '').slice(0, 20)

  const codeRef = db.collection('pairingCodes').doc(code)
  const deviceId = crypto.randomUUID()

  const parentUid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Code not found or expired.')
    const data = snap.data()
    if (data.used) throw new HttpsError('already-exists', 'Code has already been used.')
    if (data.expiresAt.toMillis() <= Date.now()) throw new HttpsError('deadline-exceeded', 'Code has expired.')

    const now = admin.firestore.Timestamp.now()
    tx.update(codeRef, { used: true, usedAt: now, deviceId })
    tx.set(db.doc(`users/${data.parentUid}/devices/${deviceId}`), {
      hostname,
      osType,
      pairedAt: now,
      lastSeen: now,
      deviceName: hostname,
      agentVersion,
      agentUid,
      status: 'online'
    })
    return data.parentUid
  })

  return { parentUid, deviceId }
})

exports.registerAgentUid = onCall({ region: REGION }, async (request) => {
  const agentUid = request.auth?.uid
  if (!agentUid) throw new HttpsError('unauthenticated', 'Sign in first.')

  const parentUid = String(request.data?.parentUid || '').trim()
  const deviceId = String(request.data?.deviceId || '').trim()
  if (!parentUid || !deviceId) throw new HttpsError('invalid-argument', 'parentUid and deviceId are required.')

  const deviceRef = db.doc(`users/${parentUid}/devices/${deviceId}`)
  const snap = await deviceRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Device not found.')

  const existing = snap.data()
  if (existing.agentUid && existing.agentUid !== agentUid) {
    throw new HttpsError('permission-denied', 'Device already has a different agent registered.')
  }

  if (existing.agentUid !== agentUid) {
    await deviceRef.update({ agentUid })
  }

  return { ok: true }
})

// ── Commands ──────────────────────────────────────────────────────────────────

const ALLOWED_COMMAND_ACTIONS = new Set([
  'lock', 'unlock', 'screenshot_request', 'fetch_logs',
  'shutdown', 'restart', 'sleep', 'hibernate',
  'update_agent', 'force_update', 'uninstall'
])

exports.sendDeviceCommand = onCall({ region: REGION }, async (request) => {
  const callerUid = requireAuth(request)
  const { ownerUid: rawOwnerUid, deviceId, action, command, ...rest } = request.data || {}

  const normalizedAction = action || command
  if (!deviceId || !normalizedAction) {
    throw new HttpsError('invalid-argument', 'deviceId and action are required.')
  }
  if (!ALLOWED_COMMAND_ACTIONS.has(normalizedAction)) {
    throw new HttpsError('invalid-argument', `Unknown action: ${normalizedAction}`)
  }

  const ownerUid = rawOwnerUid || callerUid

  if (callerUid !== ownerUid) {
    const accessSnap = await db.doc(`users/${ownerUid}/parentAccess/${callerUid}`).get()
    if (!accessSnap.exists || accessSnap.data().status !== 'active') {
      throw new HttpsError('permission-denied', 'You do not have access to this device.')
    }
  }

  const deviceSnap = await db.doc(`users/${ownerUid}/devices/${deviceId}`).get()
  if (!deviceSnap.exists) throw new HttpsError('not-found', 'Device not found.')

  const device = deviceSnap.data()
  if (!device.screenshotUploadToken) throw new HttpsError('failed-precondition', 'Device is not ready (no upload token).')

  // Allowlist safe extra fields
  const extras = {}
  if (rest.message !== undefined) extras.message = String(rest.message || '').slice(0, 500)
  if (rest.requestedAtClientMs !== undefined) extras.requestedAtClientMs = Number(rest.requestedAtClientMs) || 0
  if (rest.appId !== undefined) extras.appId = String(rest.appId || '').slice(0, 100)

  const cmdRef = await db.collection(`users/${ownerUid}/devices/${deviceId}/commands`).add({
    action: normalizedAction,
    command: normalizedAction,
    ...extras,
    uploadToken: device.screenshotUploadToken,
    status: 'pending',
    timestamp: admin.firestore.Timestamp.now()
  })

  return { commandId: cmdRef.id }
})

// ── Data cleanup ──────────────────────────────────────────────────────────────

exports.cleanupOldCommands = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const snap = await db.collectionGroup('commands')
    .where('status', 'in', ['completed', 'failed'])
    .where('timestamp', '<', cutoff)
    .limit(500)
    .get()

  if (snap.empty) {
    logger.info('cleanupOldCommands: nothing to clean')
    return
  }

  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  logger.info('cleanupOldCommands done', { deleted: snap.docs.length })
})

exports.cleanupOldActivityLogs = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const snap = await db.collectionGroup('activityLogs')
    .where('ts', '<', cutoff)
    .limit(500)
    .get()

  if (snap.empty) {
    logger.info('cleanupOldActivityLogs: nothing to clean')
    return
  }

  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  logger.info('cleanupOldActivityLogs done', { deleted: snap.docs.length })
})
