// Same signatures as shared/firebase/chats.repo.js.

import { API_BASE_URL, API_PREFIX } from './config.js'
import { api } from './client.js'
import { realtime } from './realtime.js'
import { getAccessToken } from './tokens.js'
import { timestamp as toTimestamp, withTimestamps } from './timestamp.js'

function byUpdatedAtDesc(a, b) {
  return new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0)
}

function byTimestampAsc(a, b) {
  return new Date(a.timestamp ?? 0) - new Date(b.timestamp ?? 0)
}

export function subscribeToChats(_ownerUid, callback) {
  return realtime().subscribe('chats', (chats) => {
    const shaped = chats.map(chat => {
      const copy = withTimestamps({ ...chat }, ['createdAt', 'updatedAt'])
      // The chat list shows when the last line was written, and it is nested
      // one level down.
      if (copy.lastMessage?.timestamp) {
        copy.lastMessage = { ...copy.lastMessage, timestamp: toTimestamp(copy.lastMessage.timestamp) }
      }
      return copy
    })
    callback(shaped.sort(byUpdatedAtDesc))
  })
}

export function subscribeToMessages(_ownerUid, chatId, callback, msgLimit = 100) {
  if (!chatId) return () => {}
  return realtime().subscribe(`messages:${chatId}`, (messages) => {
    // Oldest first, and only the tail: a conversation is read from the bottom,
    // and the panel asks for a window rather than the whole history.
    const ordered = [...messages]
      .sort(byTimestampAsc)
      .map(message => withTimestamps({ ...message }, ['timestamp']))
    callback(ordered.slice(-msgLimit))
  })
}

export async function createChat(_ownerUid, { type, name, deviceIds = [], parentUids = [] }) {
  const chat = await api.post('/chats', { type, name, deviceIds, parentUids })
  return chat.id
}

export async function updateChat(_ownerUid, chatId, updates) {
  await api.patch(`/chats/${chatId}`, updates)
}

export async function deleteChat(_ownerUid, chatId) {
  await api.delete(`/chats/${chatId}`)
}

/**
 * Sends a message, with or without an attachment.
 *
 * The Firebase version uploaded the file to Storage first and passed a URL;
 * here the bytes go with the request and the server keeps them. Callers that
 * already hold a File or Blob pass it as `file`.
 */
export async function sendMessage(_ownerUid, chatId, {
  text = '', file = null, fileName = null, mimeType = null,
  gifUrl = null, gifPreviewUrl = null, senderName = '', onProgress = null
} = {}) {
  if (file) {
    const params = new URLSearchParams({
      fileName: fileName || file.name || 'file',
      mimeType: mimeType || file.type || 'application/octet-stream'
    })
    if (senderName) params.set('senderName', senderName)
    if (text) params.set('text', text)

    const response = await fetch(
      `${API_BASE_URL}${API_PREFIX}/chats/${chatId}/attachments?${params}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          'Content-Type': mimeType || file.type || 'application/octet-stream'
        },
        body: file
      }
    )
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error?.message || 'Не удалось отправить файл.')
    }
    // fetch reports no upload progress, so the bar goes straight to done
    // rather than pretending to creep along.
    onProgress?.(100)
    const message = await response.json()
    return message.id
  }

  const message = await api.post(`/chats/${chatId}/messages`, {
    text, senderName, gifUrl, gifPreviewUrl
  })
  return message.id
}

export async function markMessagesRead(_ownerUid, chatId) {
  await api.post(`/chats/${chatId}/read`)
}

// Marks messages as delivered. On this backend the parent's side has nothing
// to report — a message is delivered the moment the server accepts it — so
// this exists to keep the call sites unchanged.
export async function markMessagesDelivered() {}

export async function markFileDeleted(_ownerUid, _chatId, msgId) {
  await api.post(`/chats/messages/${msgId}/delete-file`)
}

// Attachments are fetched the way screenshots are: with the token in a header,
// then shown from memory. A URL that carried its own access would end up in
// logs and in forwarded links.
const objectUrls = new Map()

export async function getAttachmentURL(message) {
  if (!message?.id) return null
  const cached = objectUrls.get(message.id)
  if (cached) return cached

  const response = await fetch(`${API_BASE_URL}${API_PREFIX}/chats/messages/${message.id}/file`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` }
  })
  if (!response.ok) throw new Error('Не удалось загрузить файл.')

  const url = URL.createObjectURL(await response.blob())
  objectUrls.set(message.id, url)
  return url
}
