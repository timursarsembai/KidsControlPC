const logger = require('firebase-functions/logger')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { admin, db, auth } = require('./firebaseAdmin')
const { REGION, requireAuth, normalizeEmail, getAppBaseUrl } = require('./config')
const { tokenHash, generateToken, generatePassword } = require('./crypto')
const { getMailTransport } = require('./mailer')
const { buildInvitationEmailHtml, buildInvitationEmailText } = require('./emailTemplates/invitationEmail')

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000

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
  const expiresAtText = formatInvitationExpiry(expiresAt)
  const templateData = { email, ownerEmail, link, temporaryPassword, expiresAtText }

  await transport.sendMail({
    from,
    to: email,
    subject: 'Приглашение родителя в KidsControlPC',
    text: buildInvitationEmailText(templateData),
    html: buildInvitationEmailHtml(templateData)
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

const createParentInvitation = onCall({ region: REGION, secrets: ['SMTP_PASS'] }, async (request) => {
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

const getParentInvitation = onCall({ region: REGION }, async (request) => {
  const { invitation } = await readInvitationByToken(request.data?.invitationId, request.data?.token)

  return {
    email: invitation.email,
    ownerEmail: invitation.ownerEmail,
    status: invitation.status,
    accountCreated: invitation.accountCreated,
    expiresAt: invitation.expiresAt.toDate().toISOString()
  }
})

const acceptParentInvitation = onCall({ region: REGION }, async (request) => {
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

const declineParentInvitation = onCall({ region: REGION }, async (request) => {
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

const revokeParentAccess = onCall({ region: REGION }, async (request) => {
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

const cleanupExpiredParentInvitations = onSchedule({ region: REGION, schedule: 'every 6 hours' }, async () => {
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

module.exports = {
  createParentInvitation,
  getParentInvitation,
  acceptParentInvitation,
  declineParentInvitation,
  revokeParentAccess,
  cleanupExpiredParentInvitations
}
