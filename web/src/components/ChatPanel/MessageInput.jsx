import { useState, useRef, useCallback, useEffect } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import GifPicker from './GifPicker'

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGif, setShowGif] = useState(false)
  const [pendingGif, setPendingGif] = useState(null)
  const textareaRef = useRef(null)
  const emojiWrapRef = useRef(null)
  const emojiBtnRef = useRef(null)

  useEffect(() => {
    if (!showEmoji) return
    const handler = (e) => {
      if (
        emojiWrapRef.current && !emojiWrapRef.current.contains(e.target) &&
        emojiBtnRef.current && !emojiBtnRef.current.contains(e.target)
      ) {
        setShowEmoji(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler) }
  }, [showEmoji])

  const handleSend = useCallback(() => {
    if ((!text.trim() && !pendingGif) || disabled) return
    onSend({ text: text.trim(), gifUrl: pendingGif?.url || null, gifPreviewUrl: pendingGif?.previewUrl || null })
    setText('')
    setPendingGif(null)
    setShowEmoji(false)
  }, [text, pendingGif, disabled, onSend])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const onEmojiSelect = (emoji) => {
    const ta = textareaRef.current
    if (!ta) { setText(t => t + emoji.native); return }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = text.slice(0, start) + emoji.native + text.slice(end)
    setText(next)
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + emoji.native.length
      ta.focus()
    }, 0)
  }

  const onGifSelect = (gif) => {
    setPendingGif(gif)
    setShowGif(false)
  }

  return (
    <div className="msg-input-wrap">
      {pendingGif && (
        <div className="msg-gif-preview">
          <img src={pendingGif.previewUrl} alt="GIF" />
          <button className="msg-gif-remove" onClick={() => setPendingGif(null)}>×</button>
        </div>
      )}

      {showEmoji && (
        <div className="emoji-picker-wrap" ref={emojiWrapRef}>
          <Picker
            data={data}
            locale="ru"
            onEmojiSelect={onEmojiSelect}
            theme="dark"
            previewPosition="none"
          />
        </div>
      )}

      {showGif && (
        <GifPicker
          onSelect={onGifSelect}
          onClose={() => setShowGif(false)}
        />
      )}

      <div className="msg-input-row">
        <button
          ref={emojiBtnRef}
          className={`msg-icon-btn ${showEmoji ? 'active' : ''}`}
          title="Эмодзи"
          onClick={() => { setShowEmoji(v => !v); setShowGif(false) }}
          type="button"
        >
          😊
        </button>
        <button
          className={`msg-icon-btn ${showGif ? 'active' : ''}`}
          title="GIF"
          onClick={() => { setShowGif(v => !v); setShowEmoji(false) }}
          type="button"
        >
          GIF
        </button>
        <textarea
          ref={textareaRef}
          className="msg-textarea"
          placeholder="Написать сообщение... (Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
        />
        <button
          className="msg-send-btn"
          onClick={handleSend}
          disabled={disabled || (!text.trim() && !pendingGif)}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M16 9L2 2l5 7-5 7 14-7z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
