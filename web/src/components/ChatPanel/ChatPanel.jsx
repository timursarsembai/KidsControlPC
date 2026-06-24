import { useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import MessageThread from './MessageThread'
import GroupManager from './GroupManager'
import './ChatPanel.css'

function isDeviceOnline(device) {
  const lastSeen = device?.lastSeen?.toDate?.()
  return device?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000
}

function formatLastMessage(chat) {
  const lm = chat.lastMessage
  if (!lm) return 'Нет сообщений'
  return lm.text || '🖼️ GIF'
}

function formatLastTime(chat) {
  const lm = chat.lastMessage
  if (!lm?.timestamp) return ''
  const d = lm.timestamp.toDate ? lm.timestamp.toDate() : new Date(lm.timestamp)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function ChatPanel() {
  const {
    chats, chatsLoading, activeChatId, selectChat, deleteGroupChat, devices
  } = useRulesStore()
  const [showGroupManager, setShowGroupManager] = useState(false)

  const activeChat = chats.find(c => c.id === activeChatId)

  const handleCreated = (chatId) => {
    setShowGroupManager(false)
    selectChat(chatId)
  }

  return (
    <div className="chat-panel">
      {/* ── Sidebar ── */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <span className="chat-sidebar-title">Чаты</span>
          <button
            className="chat-new-btn"
            onClick={() => setShowGroupManager(true)}
            title="Новый чат"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {chatsLoading && <div className="chat-loading">Загрузка...</div>}

        {!chatsLoading && chats.length === 0 && (
          <div className="chat-empty-list">
            <div className="chat-empty-icon">💬</div>
            <div>Нет чатов</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowGroupManager(true)}>
              Создать чат
            </button>
          </div>
        )}

        <div className="chat-list">
          {chats.map(chat => {
            const device = chat.type === 'direct' && chat.deviceIds?.[0]
              ? devices.find(d => d.id === chat.deviceIds[0])
              : null
            return (
              <button
                key={chat.id}
                className={`chat-list-item ${activeChatId === chat.id ? 'active' : ''}`}
                onClick={() => selectChat(chat.id)}
              >
                <div className="chat-list-avatar">
                  {chat.type === 'group' ? '👥' : '💬'}
                </div>
                <div className="chat-list-info">
                  <div className="chat-list-name">
                    {chat.name}
                    {device && (
                      <span className={`chat-device-dot ${isDeviceOnline(device) ? 'online' : ''}`} />
                    )}
                  </div>
                  <div className="chat-list-preview">{formatLastMessage(chat)}</div>
                </div>
                <div className="chat-list-time">{formatLastTime(chat)}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Thread ── */}
      <div className="chat-thread-area">
        {activeChat ? (
          <MessageThread chat={activeChat} />
        ) : (
          <div className="chat-no-chat">
            <div className="chat-no-chat-icon">💬</div>
            <div className="chat-no-chat-title">Выберите чат</div>
            <div className="chat-no-chat-desc">
              Откройте существующий чат или создайте новый
            </div>
            <button className="btn btn-primary" onClick={() => setShowGroupManager(true)}>
              + Новый чат
            </button>
          </div>
        )}
      </div>

      {showGroupManager && (
        <GroupManager
          onClose={() => setShowGroupManager(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
