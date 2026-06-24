import { db } from '../network/firebaseSync.js'
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, serverTimestamp
} from 'firebase/firestore'
import fs from 'fs'
import path from 'path'

let parentUid = null
let deviceId = null
let deviceName = null
let unsubChats = null
let unsubMessages = {}
let chats = []
let messages = {}
let repliesInterval = null

function log(msg) {
  console.log('[ChatSync] ' + msg)
}

const dataPath = () => path.join(process.cwd(), 'chat_data.json')
const repliesPath = () => path.join(process.cwd(), 'chat_replies.json')

function writeChatData() {
  const payload = {
    chats: chats.map(c => ({
      id: c.id,
      name: c.name,
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

async function checkReplies() {
  const p = repliesPath()
  if (!fs.existsSync(p)) return
  let content
  try {
    content = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(p, '[]', 'utf8')
  } catch { return }

  if (!content || content.trim() === '' || content.trim() === '[]') return
  let replies = []
  try { replies = JSON.parse(content) } catch { return }
  if (!Array.isArray(replies) || replies.length === 0) return

  for (const r of replies) {
    if (!r.chatId || !r.text) continue
    try {
      await addDoc(collection(db, 'users', parentUid, 'chats', r.chatId, 'messages'), {
        text: r.text,
        gifUrl: null,
        gifPreviewUrl: null,
        senderType: 'child',
        senderUid: null,
        senderDeviceId: deviceId,
        senderName: deviceName || 'Ребёнок',
        readBy: [],
        timestamp: serverTimestamp()
      })
      await updateDoc(doc(db, 'users', parentUid, 'chats', r.chatId), {
        lastMessage: {
          text: r.text,
          senderName: deviceName || 'Ребёнок',
          timestamp: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      })
      log('reply sent to chat ' + r.chatId)
    } catch (e) {
      log('reply error: ' + e.message)
    }
  }
}

export function initChatSync(pUid, dId, dName) {
  parentUid = pUid
  deviceId = dId
  deviceName = dName || 'Ребёнок'

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
