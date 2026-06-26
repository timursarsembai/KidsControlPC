import { useState, useRef, useCallback, useEffect } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import GifPicker from './GifPicker'
import { storage } from '@kidscontrol/shared/firebase/config'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { v4 as uuidv4 } from 'uuid'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED_TYPES = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv'

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
}

export default function MessageInput({ onSend, disabled, chatId }) {
  const user = useRulesStore(s => s.user)
  const storageUsedBytes = useRulesStore(s => s.storageUsedBytes)
  const storageQuotaBytes = useRulesStore(s => s.storageQuotaBytes)

  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGif, setShowGif] = useState(false)
  const [pendingGif, setPendingGif] = useState(null)
  const [pendingFile, setPendingFile] = useState(null) // {file, previewUrl}
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [fileError, setFileError] = useState(null)

  const textareaRef = useRef(null)
  const emojiWrapRef = useRef(null)
  const emojiBtnRef = useRef(null)
  const fileInputRef = useRef(null)

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

  const handleSend = useCallback(async () => {
    if (uploading || disabled) return
    if (!text.trim() && !pendingGif && !pendingFile) return

    if (pendingFile) {
      if (storageUsedBytes + pendingFile.file.size > storageQuotaBytes) {
        setFileError(`Хранилище заполнено (${formatBytes(storageUsedBytes)} из ${formatBytes(storageQuotaBytes)})`)
        return
      }
      setUploading(true)
      setUploadProgress(0)
      setFileError(null)
      try {
        const uid = user?.uid || 'unknown'
        const storagePath = `users/${uid}/chats/${chatId}/attachments/${uuidv4()}-${pendingFile.file.name}`
        const fileRef = storageRef(storage, storagePath)
        const task = uploadBytesResumable(fileRef, pendingFile.file)

        await new Promise((resolve, reject) => {
          task.on('state_changed',
            snap => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            resolve
          )
        })

        const fileUrl = await getDownloadURL(task.snapshot.ref)
        onSend({
          text: text.trim(),
          gifUrl: null,
          gifPreviewUrl: null,
          fileUrl,
          fileName: pendingFile.file.name,
          fileSize: pendingFile.file.size,
          mimeType: pendingFile.file.type,
          storagePath,
        })
        setText('')
        setPendingFile(null)
      } catch (err) {
        setFileError('Ошибка загрузки: ' + err.message)
      } finally {
        setUploading(false)
        setUploadProgress(0)
      }
      return
    }

    onSend({ text: text.trim(), gifUrl: pendingGif?.url || null, gifPreviewUrl: pendingGif?.previewUrl || null, fileUrl: null, fileName: null, fileSize: null, mimeType: null })
    setText('')
    setPendingGif(null)
    setShowEmoji(false)
  }, [text, pendingGif, pendingFile, disabled, uploading, onSend, chatId, user, storageUsedBytes, storageQuotaBytes])

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

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setFileError(null)

    if (file.type.startsWith('video/')) {
      setFileError('Видео не поддерживается')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Файл больше 10 МБ')
      return
    }

    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    setPendingFile({ file, previewUrl })
    setPendingGif(null)
  }

  const removePendingFile = () => {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl)
    setPendingFile(null)
    setFileError(null)
  }

  const canSend = !disabled && !uploading && (!!text.trim() || !!pendingGif || !!pendingFile)

  return (
    <div className="msg-input-wrap">
      {pendingFile && (
        <div className="msg-file-pending">
          {pendingFile.previewUrl
            ? <img src={pendingFile.previewUrl} alt="preview" className="msg-file-pending-img" />
            : <span className="msg-file-pending-icon">📎</span>
          }
          <div className="msg-file-pending-info">
            <span className="msg-file-pending-name">{pendingFile.file.name}</span>
            <span className="msg-file-pending-size">{formatBytes(pendingFile.file.size)}</span>
          </div>
          {uploading
            ? <div className="msg-upload-progress-wrap"><div className="msg-upload-progress-bar" style={{ width: uploadProgress + '%' }} /></div>
            : <button className="msg-gif-remove" onClick={removePendingFile} title="Убрать файл">×</button>
          }
        </div>
      )}

      {fileError && <div className="msg-file-error">{fileError}</div>}

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

      <input
        type="file"
        ref={fileInputRef}
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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
        <button
          className="msg-icon-btn"
          title="Прикрепить файл"
          onClick={() => fileInputRef.current?.click()}
          type="button"
          disabled={disabled || uploading}
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          className="msg-textarea"
          placeholder="Написать сообщение... (Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled || uploading}
        />
        <button
          className="msg-send-btn"
          onClick={handleSend}
          disabled={!canSend}
          type="button"
        >
          {uploading
            ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="white" strokeWidth="2" strokeDasharray="32" strokeDashoffset={32 - uploadProgress * 0.32} strokeLinecap="round" transform="rotate(-90 9 9)"/></svg>
            : <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 9L2 2l5 7-5 7 14-7z" fill="currentColor"/></svg>
          }
        </button>
      </div>
    </div>
  )
}
