// Sign-in, in one shape for both backends.
//
// The panel was written against the Firebase Auth API — onAuthStateChanged,
// signInWithEmailAndPassword, a user object with .uid and .emailVerified. That
// shape is kept here so the screens do not have to be rewritten twice: once to
// move off Firebase, and again if anything else ever changes.

import {
  createUserWithEmailAndPassword,
  deleteUser,
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
export const supportsPasswordReset = !isSelfHosted

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

export function getCurrentUser() {
  if (!isSelfHosted) return firebaseAuth.currentUser
  return normalize(selfhosted.getCurrentUser())
}

export async function sendPasswordReset(email) {
  if (!isSelfHosted) return sendPasswordResetEmail(firebaseAuth, email)
  // Failing loudly rather than pretending: a parent told "we sent you a link"
  // who then waits for mail that will never arrive is worse off than one told
  // plainly that this is not available yet.
  throw new Error('Восстановление пароля пока недоступно. Напишите в поддержку.')
}

export async function resendVerification() {
  if (!isSelfHosted) return sendEmailVerification(firebaseAuth.currentUser)
  throw new Error('Подтверждение почты пока не требуется.')
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
