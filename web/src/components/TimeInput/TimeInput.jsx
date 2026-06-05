import React, { useEffect, useRef, useState } from 'react'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function normalizeTime(value, fallback = '00:00') {
  const raw = String(value || '').trim()
  const colonMatch = raw.match(/^(\d{1,2}):(\d{0,2})$/)
  if (colonMatch) {
    const hours = clamp(Number(colonMatch[1] || 0), 0, 23)
    const minutes = clamp(Number(colonMatch[2] || 0), 0, 59)
    return `${pad2(hours)}:${pad2(minutes)}`
  }

  const digits = raw.replace(/\D/g, '')
  if (!digits) return fallback
  if (digits.length <= 2) {
    return `${pad2(clamp(Number(digits), 0, 23))}:00`
  }

  const hoursDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2)
  const minuteDigits = digits.length === 3 ? digits.slice(1, 3) : digits.slice(2, 4)
  const hours = clamp(Number(hoursDigits), 0, 23)
  const minutes = clamp(Number(minuteDigits || 0), 0, 59)
  return `${pad2(hours)}:${pad2(minutes)}`
}

function formatDraft(raw) {
  const cleaned = String(raw || '').replace(/[^\d:]/g, '')
  if (cleaned.includes(':')) {
    const [hours = '', minutes = ''] = cleaned.split(':')
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`
  }

  const digits = cleaned.slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function addMinutes(value, deltaMinutes) {
  const normalized = normalizeTime(value)
  const [hours, minutes] = normalized.split(':').map(Number)
  const total = (hours * 60 + minutes + deltaMinutes + 1440) % 1440
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

export default function TimeInput({ value, onChange, className = '', ...props }) {
  const inputRef = useRef(null)
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(value || '')

  useEffect(() => {
    if (!focusedRef.current) setDraft(value || '')
  }, [value])

  const commit = (nextValue) => {
    setDraft(nextValue)
    onChange?.(nextValue)
  }

  const handleFocus = (event) => {
    focusedRef.current = true
    props.onFocus?.(event)
    requestAnimationFrame(() => event.target.select())
  }

  const handleBlur = (event) => {
    focusedRef.current = false
    const normalized = normalizeTime(draft, value || '00:00')
    commit(normalized)
    props.onBlur?.(event)
  }

  const handleChange = (event) => {
    const nextDraft = formatDraft(event.target.value)
    setDraft(nextDraft)

    if (/^\d{2}:\d{2}$/.test(nextDraft)) {
      const normalized = normalizeTime(nextDraft)
      if (normalized === nextDraft) onChange?.(normalized)
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 1 : -1
      const cursor = event.currentTarget.selectionStart ?? 0
      const step = cursor <= 2 ? 60 : 1
      const nextValue = addMinutes(draft || value || '00:00', direction * step)
      commit(nextValue)
      requestAnimationFrame(() => {
        const position = cursor <= 2 ? 0 : 3
        inputRef.current?.setSelectionRange(position, position + 2)
      })
      return
    }

    props.onKeyDown?.(event)
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      className={`input time-input ${className}`.trim()}
      placeholder="HH:MM"
      value={draft}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  )
}
