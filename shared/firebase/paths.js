import { collection, doc } from 'firebase/firestore'
import { db } from './config.js'

export const deviceCol = (uid) => collection(db, 'users', uid, 'devices')
export const deviceDoc = (uid, devId) => doc(db, 'users', uid, 'devices', devId)

export const rulesCol = (uid, devId) => collection(db, 'users', uid, 'devices', devId, 'rules')
export const ruleDoc = (uid, devId, rId) => doc(db, 'users', uid, 'devices', devId, 'rules', rId)

export const appsCol = (uid, devId) => collection(db, 'users', uid, 'devices', devId, 'installedApps')
export const commandsCol = (uid, devId) => collection(db, 'users', uid, 'devices', devId, 'commands')

export const screenshotsCol = (uid, devId) => collection(db, 'users', uid, 'devices', devId, 'screenshots')
export const screenshotDoc = (uid, devId, screenshotId) =>
  doc(db, 'users', uid, 'devices', devId, 'screenshots', screenshotId)

export const alertsCol = (uid) => collection(db, 'users', uid, 'alerts')
export const alertDoc = (uid, alertId) => doc(db, 'users', uid, 'alerts', alertId)

export const pairingCodeDoc = (code) => doc(db, 'pairingCodes', code)
export const profileDoc = (uid) => doc(db, 'users', uid, 'profile', 'data')

export const chatsCol = (ownerUid) => collection(db, 'users', ownerUid, 'chats')
export const chatDoc = (ownerUid, chatId) => doc(db, 'users', ownerUid, 'chats', chatId)
export const messagesCol = (ownerUid, chatId) => collection(db, 'users', ownerUid, 'chats', chatId, 'messages')
export const messageDoc = (ownerUid, chatId, msgId) => doc(db, 'users', ownerUid, 'chats', chatId, 'messages', msgId)
