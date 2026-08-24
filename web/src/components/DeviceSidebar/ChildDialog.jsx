import React from 'react'
import './ChildDialog.css'

// Готовый набор вместо поля ввода эмодзи: на большинстве компьютеров
// эмодзи-клавиатуру ещё надо найти, а вставленная картинка или строка из
// пятидесяти символов сюда не годится.
const AVATARS = ['🙂', '🦊', '🐱', '🐶', '🐼', '🐨', '🦁', '🐧', '🐢', '🦄', '⚽', '🎸', '🚀', '🌟', '🎨', '📚']

export default function ChildDialog({ child = null, onSave, onClose }) {
  const [name, setName] = React.useState(child?.name ?? '')
  const [avatar, setAvatar] = React.useState(child?.avatar ?? '🙂')
  const [note, setNote] = React.useState(child?.note ?? '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(null)
  const inputRef = React.useRef(null)

  React.useEffect(() => { inputRef.current?.focus() }, [])

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Укажите имя ребёнка.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: trimmed, avatar, note: note.trim() || null })
      onClose()
    } catch (err) {
      // Окно остаётся открытым: набранное имя не должно пропасть вместе с
      // сообщением об ошибке.
      setError(err?.message || 'Не удалось сохранить профиль.')
      setSaving(false)
    }
  }

  return (
    <div className="child-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="child-dialog" onSubmit={submit}>
        <h3 className="child-dialog-title">
          {child ? 'Профиль ребёнка' : 'Новый профиль ребёнка'}
        </h3>

        <label className="child-dialog-label" htmlFor="child-name">Имя</label>
        <input
          id="child-name"
          ref={inputRef}
          className="child-dialog-input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Айдана"
        />

        <span className="child-dialog-label">Значок</span>
        <div className="child-dialog-avatars">
          {AVATARS.map(item => (
            <button
              key={item}
              type="button"
              className={`child-dialog-avatar ${avatar === item ? 'active' : ''}`}
              onClick={() => setAvatar(item)}
              aria-label={`Значок ${item}`}
              aria-pressed={avatar === item}
            >
              {item}
            </button>
          ))}
        </div>

        <label className="child-dialog-label" htmlFor="child-note">Заметка (необязательно)</label>
        <input
          id="child-note"
          className="child-dialog-input"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="3 класс"
        />

        {error && <div className="child-dialog-error">{error}</div>}

        <div className="child-dialog-actions">
          <button type="button" className="child-dialog-btn" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button type="submit" className="child-dialog-btn child-dialog-btn--primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  )
}
