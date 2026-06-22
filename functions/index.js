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
  const passwordBlock = temporaryPassword
    ? `\nTemporary password: ${temporaryPassword}\nUse it only to accept the invitation. The app will ask you to set a new password after confirmation.\n`
    : '\nUse your existing KidsControlPC password to accept the invitation.\n'

  await transport.sendMail({
    from,
    to: email,
    subject: 'KidsControlPC parent invitation',
    text: [
      `${ownerEmail || 'A KidsControlPC parent'} invited you to manage child devices in KidsControlPC.`,
      '',
      `Open this link to review and accept or decline the invitation: ${link}`,
      passwordBlock,
      `This invitation expires at ${expiresAt.toISOString()}. If you do not accept, the invitation and temporary account are removed automatically.`,
      '',
      'If you did not expect this invitation, ignore this email or decline it from the link.'
    ].join('\n')
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
