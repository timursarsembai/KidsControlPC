import { db } from '../network/firebaseSync.js'
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, serverTimestamp
} from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { execAsync } from '../core/utils.js'
import { CHAT_DATA_DIR } from '../config.js'

let parentUid = null
let deviceId = null
let deviceName = null
let unsubChats = null
let unsubMessages = {}
let chats = []
let messages = {}
let repliesInterval = null

const syncLogPath = path.join(CHAT_DATA_DIR, 'chat_sync.log')

function log(msg) {
  const line = new Date().toISOString() + ' [ChatSync] ' + msg
  console.log(line)
  try {
    fs.appendFileSync(syncLogPath, line + '\n', 'utf8')
  } catch {}
}

const dataPath = () => path.join(CHAT_DATA_DIR, 'chat_data.json')
const repliesPath = () => path.join(CHAT_DATA_DIR, 'chat_replies.json')

async function ensureDataDir() {
  try {
    if (!fs.existsSync(CHAT_DATA_DIR)) {
      fs.mkdirSync(CHAT_DATA_DIR, { recursive: true })
    }
    // Grant interactive users modify rights so ChatTrayApp (limited user) can
    // read chat_data.json and write chat_replies.json in this SYSTEM-owned dir.
    await execAsync(`icacls "${CHAT_DATA_DIR}" /grant *S-1-5-32-545:(OI)(CI)M /T`, { timeout: 8000, windowsHide: true })
      .catch(() => {})
  } catch (e) {
    log('ensureDataDir error: ' + e.message)
  }
}

function writeChatData() {
  const payload = {
    chats: chats.map(c => ({
      id: c.id,
      // Group chats show their group name; direct chats show who the child is
      // talking to (the parent's role, e.g. "Папа"), falling back to chat name.
      name: c.type === 'group' ? (c.name || c.parentName) : (c.parentName || c.name),
      type: c.type || 'group',
      lastMessage: c.lastMessage || null
    })),
    messages,
    updatedAt: Date.now()
  }
  try {
    fs.writeFileSync(dataPath(), JSON.stringify(payload), 'utf8')
  } catch (e) {
    log('write error: ' + e.message)
  }
}

function subscribeToMessages(chatId) {
  if (unsubMessages[chatId]) return
  const msgsCol = collection(db, 'users', parentUid, 'chats', chatId, 'messages')
  unsubMessages[chatId] = onSnapshot(msgsCol, (snap) => {
    messages[chatId] = snap.docs
      .map(d => {
        const m = d.data()
        return {
          id: d.id,
          text: m.text || '',
          gifUrl: m.gifUrl || null,
          gifPreviewUrl: m.gifPreviewUrl || null,
          fileUrl: m.fileUrl || null,
          fileName: m.fileName || null,
          fileSize: m.fileSize || null,
          mimeType: m.mimeType || null,
          senderName: m.senderName || '',
          senderType: m.senderType || 'parent',
          timestamp: m.timestamp?.toDate?.()?.toISOString() || null
        }
      })
      .sort((a, b) => {
        if (!a.timestamp) return -1
        if (!b.timestamp) return 1
        return a.timestamp < b.timestamp ? -1 : 1
      })
    writeChatData()
  }, (err) => {
    log('messages error ' + chatId + ': ' + err.message)
  })
}

async function uploadChatAttachment(r) {
  const bytes = fs.readFileSync(r.filePath)
  const uuid = randomBytes(12).toString('hex')
  const safeName = path.basename(r.fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `users/${parentUid}/chats/${r.chatId}/attachments/${uuid}-${safeName}`
  const ref = storageRef(getStorage(), storagePath)
  await uploadBytes(ref, bytes, { contentType: r.mimeType || 'application/octet-stream' })
  try { fs.unlinkSync(r.filePath) } catch {}
  return await getDownloadURL(ref)
}

async function checkReplies() {
  const p = repliesPath()
  if (!fs.existsSync(p)) return
  let content
  try {
    content = fs.readFileSync(p, 'utf8')
  } catch (e) {
    log('checkReplies read error: ' + e.message)
    return
  }

  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1) // strip UTF-8 BOM written by C#
  if (!content || content.trim() === '' || content.trim() === '[]') return
  let replies = []
  try { replies = JSON.parse(content) } catch (e) {
    log('checkReplies parse error: ' + e.message + ' content=' + content.slice(0, 200))
    return
  }
  if (!Array.isArray(replies) || replies.length === 0) return

  log('checkReplies found ' + replies.length + ' replies, parentUid=' + parentUid + ' deviceId=' + deviceId)

  // Clear file first so ChatTrayApp can write new replies immediately.
  // Failed replies are written back at the end to avoid permanent data loss.
  try { fs.writeFileSync(p, '[]', 'utf8') } catch {}

  const failed = []
  for (const r of replies) {
    if (!r.chatId || (!r.text && !r.filePath && !r.gifUrl)) {
      log('checkReplies skip invalid reply: ' + JSON.stringify(r))
      continue
    }
    log('checkReplies sending chatId=' + r.chatId + ' text=' + r.text + (r.filePath ? ' file=' + r.fileName : '') + (r.gifUrl ? ' gif' : ''))
    try {
      let fileUrl = null
      if (r.filePath) {
        if (r.fileSize && r.fileSize > 10 * 1024 * 1024) {
          log('checkReplies skip oversized file: ' + r.fileSize)
        } else {
          fileUrl = await uploadChatAttachment(r)
          log('attachment uploaded OK fileUrl=' + fileUrl)
        }
      }

      const lastText = r.fileName ? `📎 ${r.fileName}` : (r.gifUrl ? '🖼️ GIF' : (r.text || ''))
      await addDoc(collection(db, 'users', parentUid, 'chats', r.chatId, 'messages'), {
        text: r.text || '',
        gifUrl: r.gifUrl || null,
        gifPreviewUrl: r.gifPreviewUrl || null,
        fileUrl: fileUrl || null,
        fileName: r.fileName || null,
        fileSize: r.fileSize || null,
        mimeType: r.mimeType || null,
        senderType: 'child',
        senderUid: null,
        senderDeviceId: deviceId,
        senderName: deviceName || 'Ребёнок',
        readBy: [],
        timestamp: serverTimestamp()
      })
      await updateDoc(doc(db, 'users', parentUid, 'chats', r.chatId), {
        lastMessage: {
          text: lastText,
          senderName: deviceName || 'Ребёнок',
          timestamp: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      })
      log('reply sent OK chatId=' + r.chatId)
    } catch (e) {
      log('reply error chatId=' + r.chatId + ': ' + e.message)
      failed.push(r)
    }
  }

  // Write back any failed replies so they'll be retried next tick
  if (failed.length > 0) {
    try {
      const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8') || '[]') : []
      fs.writeFileSync(p, JSON.stringify([...failed, ...existing]), 'utf8')
    } catch {}
  }
}

export async function initChatSync(pUid, dId, dName) {
  parentUid = pUid
  deviceId = dId
  deviceName = dName || 'Ребёнок'

  await ensureDataDir()

  // Rotate log file if it exceeds 512 KB
  try {
    if (fs.existsSync(syncLogPath) && fs.statSync(syncLogPath).size > 512 * 1024) {
      fs.writeFileSync(syncLogPath, '', 'utf8')
    }
  } catch {}
  log('initChatSync pUid=' + pUid + ' dId=' + dId + ' dName=' + dName)

  const chatsCol = collection(db, 'users', parentUid, 'chats')
  unsubChats = onSnapshot(chatsCol, (snap) => {
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    const mine = all.filter(c => Array.isArray(c.deviceIds) && c.deviceIds.includes(deviceId))

    // Unsubscribe removed chats
    const mineIds = new Set(mine.map(c => c.id))
    for (const [cid, unsub] of Object.entries(unsubMessages)) {
      if (!mineIds.has(cid)) {
        unsub()
        delete unsubMessages[cid]
        delete messages[cid]
      }
    }

    chats = mine
    for (const c of chats) subscribeToMessages(c.id)
    writeChatData()
    log(chats.length + ' chats for device ' + deviceId)
  }, (err) => {
    log('chats error: ' + err.message)
  })

  repliesInterval = setInterval(checkReplies, 3000)
  log('initialized')
}

export function stopChatSync() {
  if (unsubChats) { unsubChats(); unsubChats = null }
  for (const unsub of Object.values(unsubMessages)) unsub()
  unsubMessages = {}
  if (repliesInterval) { clearInterval(repliesInterval); repliesInterval = null }
}
