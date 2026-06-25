import { useEffect, useRef, useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import MessageInput from './MessageInput'

function formatTime(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export default function MessageThread({ chat }) {
  const { user, chatMessages, sendChatMessage, deleteGroupChat } = useRulesStore()
  const bottomRef = useRef(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async () => {
    await deleteGroupChat(chat.id)
    setConfirmDelete(false)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [chat?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length])

  const handleSend = async ({ text, gifUrl, gifPreviewUrl }) => {
    await sendChatMessage(chat.id, { text, gifUrl, gifPreviewUrl })
  }

  let lastDateLabel = null

  return (
    <div className="msg-thread">
      <div className="msg-thread-header">
        <div className="msg-thread-title">
          {chat.type === 'group' ? '👥' : '💬'} {chat.name}
          {chat.type === 'group' && (
            <span className="msg-thread-meta">{chat.deviceIds?.length || 0} устройств</span>
          )}
        </div>
        {confirmDelete ? (
          <div className="msg-delete-confirm">
            <span>Удалить чат?</span>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>Да</button>
            <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Нет</button>
          </div>
        ) : (
          <button className="msg-delete-btn" onClick={() => setConfirmDelete(true)} title="Удалить чат">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9H3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      <div className="msg-thread-messages">
        {chatMessages.length === 0 && (
          <div className="msg-empty">Нет сообщений. Напишите первым!</div>
        )}

        {chatMessages.map((msg, i) => {
          const isMe = msg.senderType === 'parent' && msg.senderUid === user?.uid
          const isChild = msg.senderType === 'child'
          const dateLabel = formatDate(msg.timestamp)
          const showDate = dateLabel !== lastDateLabel
          lastDateLabel = dateLabel

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="msg-date-divider"><span>{dateLabel}</span></div>
              )}
              <div className={`msg-bubble-wrap ${isMe ? 'me' : isChild ? 'child' : 'other-parent'}`}>
                {!isMe && (
                  <div className="msg-sender-name">{msg.senderName}</div>
                )}
                <div className="msg-bubble">
                  {msg.text && <div className="msg-text">{msg.text}</div>}
                  {msg.gifUrl && (
                    <div className="msg-gif">
                      <img src={msg.gifPreviewUrl || msg.gifUrl} alt="GIF" loading="lazy" />
                    </div>
                  )}
                  <div className="msg-time">{formatTime(msg.timestamp)}</div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <MessageInput onSend={handleSend} />
    </div>
  )
}
