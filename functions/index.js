const crypto = require('crypto')
const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const nodemailer = require('nodemailer')

admin.initializeApp()

const db = admin.firestore()
const auth = admin.auth()

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000
const REGION = process.env.FUNCTIONS_REGION || 'us-central1'

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
    timeZone: 'Asia/Qyzylorda',
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

exports.cleanupExpiredParentInvitations = onSchedule({ region: REGION, schedule: 'every 6 hours' }, async () => {
  const now = admin.firestore.Timestamp.now()
  const snap = await db.collection('parentInvitations')
    .where('cleanupAt', '<=', now)
    .limit(100)
    .get()

  await Promise.all(snap.docs.map(async (docSnap) => {
    const invitation = docSnap.data()
    if (invitation.status === 'accepted') return

    const { ownerRef } = invitationRefs(docSnap.id, invitation.ownerUid)
    await Promise.allSettled([
      docSnap.ref.delete(),
      ownerRef.delete()
    ])

    if (invitation.accountCreated && invitation.invitedUserUid) {
      await auth.deleteUser(invitation.invitedUserUid).catch((error) => {
        if (error.code !== 'auth/user-not-found') {
          logger.warn('Failed to delete expired temporary parent account', { uid: invitation.invitedUserUid, error })
        }
      })
    }
  }))
})
