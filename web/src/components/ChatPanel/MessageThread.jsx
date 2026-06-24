import { useEffect, useRef } from 'react'
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
  const { user, chatMessages, sendChatMessage } = useRulesStore()
  const bottomRef = useRef(null)

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
        </div>
        {chat.type === 'group' && (
          <div className="msg-thread-meta">{chat.deviceIds?.length || 0} устройств</div>
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
