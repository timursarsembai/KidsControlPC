import { useState, useEffect, useRef, useCallback } from 'react'

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY || ''
const GIPHY_SEARCH = 'https://api.giphy.com/v1/gifs/search'
const GIPHY_TRENDING = 'https://api.giphy.com/v1/gifs/trending'
const LIMIT = 24

export default function GifPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  const fetchGifs = useCallback(async (q) => {
    if (!GIPHY_KEY) return
    setLoading(true)
    try {
      const url = q
        ? `${GIPHY_SEARCH}?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&lang=ru&limit=${LIMIT}&rating=g`
        : `${GIPHY_TRENDING}?api_key=${GIPHY_KEY}&limit=${LIMIT}&rating=g`
      const res = await fetch(url)
      const json = await res.json()
      setGifs(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGifs('')
    inputRef.current?.focus()
  }, [fetchGifs])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchGifs(query), 400)
    return () => clearTimeout(debounceRef.current)
  }, [query, fetchGifs])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="gif-picker-overlay" onClick={onClose}>
      <div className="gif-picker" onClick={e => e.stopPropagation()}>
        <div className="gif-picker-header">
          <input
            ref={inputRef}
            className="gif-search-input"
            placeholder="Поиск GIF на русском или английском..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button className="gif-close-btn" onClick={onClose}>×</button>
        </div>

        {!GIPHY_KEY && (
          <div className="gif-no-key">
            GIF-поиск недоступен — укажите VITE_GIPHY_API_KEY в .env файле
          </div>
        )}

        {loading && <div className="gif-loading">Загрузка...</div>}

        {!loading && GIPHY_KEY && (
          <div className="gif-grid">
            {gifs.map(gif => (
              <button
                key={gif.id}
                className="gif-item"
                onClick={() => onSelect({
                  url: gif.images.original.url,
                  previewUrl: gif.images.fixed_height_small.url
                })}
              >
                <img
                  src={gif.images.fixed_height_small.url}
                  alt={gif.title}
                  loading="lazy"
                />
              </button>
            ))}
            {gifs.length === 0 && query && (
              <div className="gif-empty">Ничего не найдено</div>
            )}
          </div>
        )}

        <div className="gif-attribution">
          Powered by GIPHY
        </div>
      </div>
    </div>
  )
}
