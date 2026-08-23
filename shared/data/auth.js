// Sign-in, in one shape for both backends.
//
// The panel was written against the Firebase Auth API — onAuthStateChanged,
// signInWithEmailAndPassword, a user object with .uid and .emailVerified. That
// shape is kept here so the screens do not have to be rewritten twice: once to
// move off Firebase, and again if anything else ever changes.

import {
  createUserWithEmailAndPassword,
  deleteUser,
  updatePassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth'
import { auth as firebaseAuth } from '../firebase/config.js'
import * as selfhosted from '../selfhosted/auth.js'
import { isSelfHosted } from './backend.js'

// Email verification is not part of the self-hosted first version — sending
// mail is its own piece of work, and it is deferred. Reporting false here
// would lock every parent out of their own panel, because the sign-in screen
// refuses to proceed without it.
function normalize(user) {
  if (!user) return null
  return {
    uid: user.id,
    email: user.email,
    emailVerified: true
  }
}

export const supportsEmailVerification = !isSelfHosted
// Both backends can now do this; whether mail is actually configured is
// answered by mailCapabilities().
export const supportsPasswordReset = true

/**
 * Fires with the current user and again whenever it changes.
 * @returns {() => void} unsubscribe
 */
export function onAuthChanged(callback) {
  if (!isSelfHosted) return onAuthStateChanged(firebaseAuth, callback)

  const unsubscribe = selfhosted.onAuthChanged(user => callback(normalize(user)))
  // Firebase restores its session before firing; ours has to ask the server
  // whether the stored token is still good.
  selfhosted.restoreSession().catch(() => {})
  return unsubscribe
}

export async function signIn(email, password) {
  if (!isSelfHosted) {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)
    return credential.user
  }
  return normalize(await selfhosted.login(email, password))
}

export async function signUp(email, password) {
  if (!isSelfHosted) {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
    return credential.user
  }
  return normalize(await selfhosted.register(email, password))
}

export async function signOutUser() {
  if (!isSelfHosted) return signOut(firebaseAuth)
  return selfhosted.logout()
}

// Firebase deletes the account on the strength of a recent sign-in and asks
// the caller to re-authenticate if the session is stale. The self-hosted
// backend asks for the password instead — same intent, and it works whether or
// not the parent signed in five minutes ago.
export const requiresPasswordToDelete = isSelfHosted

export async function deleteAccount(password) {
  if (!isSelfHosted) return deleteUser(firebaseAuth.currentUser)
  return selfhosted.deleteAccount(password)
}

/**
 * Firebase changes a password on the strength of a recent sign-in and refuses
 * with auth/requires-recent-login otherwise, so it never sees the current one.
 * The self-hosted backend asks for it instead — which also works for a parent
 * who signed in yesterday.
 */
export async function changePassword(currentPassword, newPassword) {
  if (!isSelfHosted) return updatePassword(firebaseAuth.currentUser, newPassword)
  return selfhosted.changePassword(currentPassword, newPassword)
}

export const requiresCurrentPasswordToChange = isSelfHosted

export function getCurrentUser() {
  if (!isSelfHosted) return firebaseAuth.currentUser
  return normalize(selfhosted.getCurrentUser())
}

export async function sendPasswordReset(email) {
  if (!isSelfHosted) return sendPasswordResetEmail(firebaseAuth, email)
  return selfhosted.requestPasswordReset(email)
}

// Second half of recovery: the parent arrives from their mailbox with a token.
export async function resetPasswordWithToken(token, password) {
  if (!isSelfHosted) {
    // Firebase handles this on its own hosted page, reached from its own
    // email; the panel never sees a token.
    throw new Error('Восстановление пароля выполняется по ссылке из письма.')
  }
  return selfhosted.resetPassword(token, password)
}

export async function confirmEmailWithToken(token) {
  if (!isSelfHosted) throw new Error('Подтверждение выполняется по ссылке из письма.')
  return selfhosted.confirmEmail(token)
}

/**
 * What this backend can actually do. Firebase can always send; the
 * self-hosted one only once a mailbox is configured, and until then the panel
 * should not offer recovery it cannot deliver.
 */
export async function mailCapabilities() {
  if (!isSelfHosted) return { passwordReset: true, emailVerification: true }
  return selfhosted.getCapabilities()
}

export async function resendVerification() {
  if (!isSelfHosted) return sendEmailVerification(firebaseAuth.currentUser)
  return selfhosted.sendVerificationEmail()
}

export async function reloadUser() {
  if (!isSelfHosted) {
    await firebaseAuth.currentUser?.reload()
    return firebaseAuth.currentUser
  }
  return normalize(await selfhosted.restoreSession())
}

/**
 * Turns a backend error into something a parent can read. Firebase uses
 * auth/* codes; the self-hosted API uses its own.
 */
export function authErrorMessage(error) {
  const code = error?.code
  const messages = {
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/email-already-in-use': 'Email уже зарегистрирован',
    'auth/invalid-email': 'Неверный формат email',
    'auth/invalid-credential': 'Неверный email или пароль',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
    invalid_credentials: 'Неверный email или пароль',
    email_taken: 'Email уже зарегистрирован',
    invalid_email: 'Неверный формат email',
    too_many_requests: 'Слишком много попыток. Попробуйте позже',
    network_error: 'Нет связи с сервером'
  }
  return messages[code] || error?.message || 'Не удалось выполнить вход'
}
