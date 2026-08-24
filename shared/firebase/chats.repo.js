import {
  addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit,
  serverTimestamp as fsServerTimestamp,
  arrayUnion, getDocs, doc
} from 'firebase/firestore'
import { db } from './config.js'
import { chatsCol, chatDoc, messagesCol } from './paths.js'

const ts = () => fsServerTimestamp()

// ── Chats ──────────────────────────────────────────────────────────────────────

export async function createChat(ownerUid, { type, name, deviceIds = [], parentUids = [], createdBy = null }) {
  const ref = await addDoc(chatsCol(ownerUid), {
    type,
    name: name || '',
    ownerUid,
    // UID of the parent who created this chat. Direct chats are private to their
    // creator; group chats are visible to all parents (see chatSlice.initChats).
    createdBy: createdBy || ownerUid,
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

/**
 * Uploads an attachment to Storage and reports progress.
 *
 * Moved here out of MessageInput: the panel component had Firebase Storage
 * wired into it directly, so on any other backend sending a file silently went
 * to the wrong place. Which backend stores what belongs in this layer.
 */
async function uploadAttachment(ownerUid, chatId, file, onProgress) {
  const { getStorage, ref: storageRef, uploadBytesResumable, getDownloadURL } =
    await import('firebase/storage')
  const { v4: uuidv4 } = await import('uuid')

  const storagePath = `users/${ownerUid}/chats/${chatId}/attachments/${uuidv4()}-${file.name}`
  const task = uploadBytesResumable(storageRef(getStorage(), storagePath), file)

  await new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snap => onProgress?.(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      reject,
      resolve
    )
  })

  return { fileUrl: await getDownloadURL(task.snapshot.ref), storagePath }
}

export async function sendMessage(ownerUid, chatId, {
  text = '',
  file = null,
  onProgress = null,
  gifUrl = null,
  gifPreviewUrl = null,
  fileUrl = null,
  fileName = null,
  fileSize = null,
  mimeType = null,
  storagePath = null,
  senderType,   // 'parent' | 'child'
  senderUid = null,
  senderDeviceId = null,
  senderName = '',
  parentName = null
}) {
  // A File means the caller handed over the bytes and expects this layer to
  // put them somewhere; the older call style passes an already-uploaded URL.
  if (file) {
    const uploaded = await uploadAttachment(ownerUid, chatId, file, onProgress)
    fileUrl = uploaded.fileUrl
    storagePath = uploaded.storagePath
    fileName = fileName || file.name
    fileSize = fileSize ?? file.size
    mimeType = mimeType || file.type
  }

  const msgRef = await addDoc(messagesCol(ownerUid, chatId), {
    text,
    gifUrl,
    gifPreviewUrl,
    fileUrl,
    fileName,
    fileSize,
    mimeType,
    storagePath,
    fileDeleted: false,
    senderType,
    senderUid,
    senderDeviceId,
    senderName,
    readBy: senderDeviceId ? [senderDeviceId] : [],
    deliveredTo: senderDeviceId ? [senderDeviceId] : [],
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
    unread.map(d => updateDoc(d.ref, {
      // Opening a chat implies both delivery and read.
      deliveredTo: arrayUnion(deviceId),
      readBy: arrayUnion(deviceId)
    }))
  )
}

export async function markFileDeleted(ownerUid, chatId, msgId) {
  await updateDoc(doc(db, 'users', ownerUid, 'chats', chatId, 'messages', msgId), { fileDeleted: true })
}

// Mark messages from others as delivered to this reader (received by their app),
// without marking them read. Used when the app receives messages in the background.
export async function markMessagesDelivered(ownerUid, chatId, readerId) {
  const snap = await getDocs(messagesCol(ownerUid, chatId))
  const undelivered = snap.docs.filter(d => {
    const data = d.data()
    return data.senderDeviceId !== readerId && !(data.deliveredTo || []).includes(readerId)
  })
  await Promise.all(
    undelivered.map(d => updateDoc(d.ref, { deliveredTo: arrayUnion(readerId) }))
  )
}
