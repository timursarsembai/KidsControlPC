import {
  addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit,
  serverTimestamp as fsServerTimestamp,
  arrayUnion, getDocs
} from 'firebase/firestore'
import { chatsCol, chatDoc, messagesCol, messageDoc } from './paths.js'

const ts = () => fsServerTimestamp()

// ── Chats ──────────────────────────────────────────────────────────────────────

export async function createChat(ownerUid, { type, name, deviceIds = [], parentUids = [] }) {
  const ref = await addDoc(chatsCol(ownerUid), {
    type,
    name: name || '',
    ownerUid,
    deviceIds,
    parentUids,
    lastMessage: null,
    createdAt: ts(),
    updatedAt: ts()
  })
  return ref.id
}

export async function updateChat(ownerUid, chatId, updates) {
  await updateDoc(chatDoc(ownerUid, chatId), { ...updates, updatedAt: ts() })
}

export async function deleteChat(ownerUid, chatId) {
  await deleteDoc(chatDoc(ownerUid, chatId))
}

export function subscribeToChats(ownerUid, callback) {
  return onSnapshot(chatsCol(ownerUid), snap => {
    const chats = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
    callback(chats)
  }, (err) => {
    console.error('subscribeToChats error:', err)
    callback([])
  })
}

// ── Messages ───────────────────────────────────────────────────────────────────

export async function sendMessage(ownerUid, chatId, {
  text = '',
  gifUrl = null,
  gifPreviewUrl = null,
  fileUrl = null,
  fileName = null,
  fileSize = null,
  mimeType = null,
  senderType,   // 'parent' | 'child'
  senderUid = null,
  senderDeviceId = null,
  senderName = '',
  parentName = null
}) {
  const msgRef = await addDoc(messagesCol(ownerUid, chatId), {
    text,
    gifUrl,
    gifPreviewUrl,
    fileUrl,
    fileName,
    fileSize,
    mimeType,
    senderType,
    senderUid,
    senderDeviceId,
    senderName,
    readBy: senderDeviceId ? [senderDeviceId] : [],
    timestamp: ts()
  })

  const lastText = fileName ? `📎 ${fileName}` : (gifUrl ? '🖼️ GIF' : text)
  const chatUpdate = {
    lastMessage: { text: lastText, senderName, timestamp: ts() },
    updatedAt: ts()
  }
  if (parentName) chatUpdate.parentName = parentName
  await updateDoc(chatDoc(ownerUid, chatId), chatUpdate)

  return msgRef.id
}

export function subscribeToMessages(ownerUid, chatId, callback, msgLimit = 100) {
  const q = query(messagesCol(ownerUid, chatId), orderBy('timestamp', 'asc'), limit(msgLimit))
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function markMessagesRead(ownerUid, chatId, deviceId) {
  const snap = await getDocs(messagesCol(ownerUid, chatId))
  const unread = snap.docs.filter(d => {
    const data = d.data()
    return data.senderDeviceId !== deviceId && !(data.readBy || []).includes(deviceId)
  })
  await Promise.all(
    unread.map(d => updateDoc(d.ref, { readBy: arrayUnion(deviceId) }))
  )
}
