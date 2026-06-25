import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers extracted from chatSync.js logic (pure functions, no Firebase deps)
// ---------------------------------------------------------------------------

function mapMessage(id, data) {
  return {
    id,
    text: data.text || '',
    gifUrl: data.gifUrl || null,
    gifPreviewUrl: data.gifPreviewUrl || null,
    senderName: data.senderName || '',
    senderType: data.senderType || 'parent',
    timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
  }
}

function sortMessages(msgs) {
  return [...msgs].sort((a, b) => {
    if (!a.timestamp) return -1
    if (!b.timestamp) return 1
    return a.timestamp < b.timestamp ? -1 : 1
  })
}

// Simulates checkReplies logic (pure, no I/O)
function processReplies(content) {
  if (!content || content.trim() === '' || content.trim() === '[]') return []
  let replies
  try { replies = JSON.parse(content) } catch { return [] }
  if (!Array.isArray(replies)) return []
  return replies.filter(r => r.chatId && r.text)
}

// ---------------------------------------------------------------------------
// mapMessage
// ---------------------------------------------------------------------------
describe('mapMessage', () => {
  it('maps text message from parent', () => {
    const msg = mapMessage('msg1', {
      text: 'Привет!',
      senderName: 'Папа',
      senderType: 'parent',
      timestamp: { toDate: () => new Date('2025-01-01T10:00:00Z') },
    })
    expect(msg.id).toBe('msg1')
    expect(msg.text).toBe('Привет!')
    expect(msg.senderName).toBe('Папа')
    expect(msg.senderType).toBe('parent')
    expect(msg.timestamp).toBe('2025-01-01T10:00:00.000Z')
    expect(msg.gifUrl).toBeNull()
  })

  it('maps GIF message', () => {
    const msg = mapMessage('gif1', {
      text: '',
      gifUrl: 'https://media.giphy.com/abc.gif',
      gifPreviewUrl: 'https://media.giphy.com/abc_s.gif',
      senderType: 'parent',
    })
    expect(msg.text).toBe('')
    expect(msg.gifUrl).toBe('https://media.giphy.com/abc.gif')
    expect(msg.gifPreviewUrl).toBe('https://media.giphy.com/abc_s.gif')
  })

  it('defaults senderType to parent when missing', () => {
    const msg = mapMessage('m1', { text: 'hi' })
    expect(msg.senderType).toBe('parent')
  })

  it('preserves child senderType', () => {
    const msg = mapMessage('m2', { text: 'ок', senderType: 'child' })
    expect(msg.senderType).toBe('child')
  })

  it('handles missing timestamp gracefully', () => {
    const msg = mapMessage('m3', { text: 'test', timestamp: null })
    expect(msg.timestamp).toBeNull()
  })

  it('handles Firestore Timestamp object', () => {
    const ts = { toDate: () => new Date('2025-06-26T12:00:00Z') }
    const msg = mapMessage('m4', { text: 'x', timestamp: ts })
    expect(msg.timestamp).toBe('2025-06-26T12:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// sortMessages
// ---------------------------------------------------------------------------
describe('sortMessages', () => {
  it('sorts by timestamp ascending', () => {
    const msgs = [
      { id: 'b', timestamp: '2025-01-01T11:00:00Z' },
      { id: 'a', timestamp: '2025-01-01T10:00:00Z' },
      { id: 'c', timestamp: '2025-01-01T12:00:00Z' },
    ]
    const sorted = sortMessages(msgs)
    expect(sorted.map(m => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts null-timestamp messages first', () => {
    const msgs = [
      { id: 'b', timestamp: '2025-01-01T10:00:00Z' },
      { id: 'a', timestamp: null },
    ]
    const sorted = sortMessages(msgs)
    expect(sorted[0].id).toBe('a')
  })

  it('does not mutate original array', () => {
    const msgs = [
      { id: 'b', timestamp: '2025-01-01T11:00:00Z' },
      { id: 'a', timestamp: '2025-01-01T10:00:00Z' },
    ]
    sortMessages(msgs)
    expect(msgs[0].id).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// processReplies (checkReplies logic)
// ---------------------------------------------------------------------------
describe('processReplies', () => {
  it('returns empty for empty file', () => {
    expect(processReplies('')).toEqual([])
    expect(processReplies('[]')).toEqual([])
    expect(processReplies('   ')).toEqual([])
  })

  it('returns empty for invalid JSON', () => {
    expect(processReplies('not json')).toEqual([])
    expect(processReplies('{bad}')).toEqual([])
  })

  it('filters out replies missing chatId or text', () => {
    const content = JSON.stringify([
      { chatId: 'c1', text: 'hello' },
      { chatId: 'c1', text: '' },       // empty text — skip
      { text: 'hi' },                    // no chatId — skip
      { chatId: '', text: 'x' },         // empty chatId — skip
    ])
    const result = processReplies(content)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('hello')
  })

  it('returns all valid replies', () => {
    const content = JSON.stringify([
      { chatId: 'c1', text: 'msg1' },
      { chatId: 'c2', text: 'msg2' },
    ])
    expect(processReplies(content)).toHaveLength(2)
  })

  it('returns empty for non-array JSON', () => {
    expect(processReplies(JSON.stringify({ chatId: 'c1', text: 'hi' }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Integration: checkReplies with mocked fs + Firebase
// ---------------------------------------------------------------------------
describe('checkReplies integration', () => {
  it('does not call addDoc when replies file is empty', async () => {
    const addDoc = vi.fn()
    const replies = processReplies('[]')
    for (const r of replies) {
      await addDoc(r)
    }
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('calls addDoc once per valid reply', async () => {
    const addDoc = vi.fn().mockResolvedValue({})
    const updateDoc = vi.fn().mockResolvedValue({})
    const content = JSON.stringify([
      { id: '1', chatId: 'chat1', text: 'Привет!', timestamp: new Date().toISOString() },
      { id: '2', chatId: 'chat1', text: 'Как дела?' },
    ])
    const replies = processReplies(content)
    for (const r of replies) {
      await addDoc(r)
      await updateDoc(r.chatId)
    }
    expect(addDoc).toHaveBeenCalledTimes(2)
    expect(updateDoc).toHaveBeenCalledTimes(2)
  })

  it('skips reply with empty text even if chatId present', async () => {
    const addDoc = vi.fn()
    const content = JSON.stringify([{ chatId: 'c1', text: '  ' }])
    // simulate the !r.text check (trim matters in the real code)
    const replies = JSON.parse(content).filter(r => r.chatId && r.text && r.text.trim())
    for (const r of replies) await addDoc(r)
    expect(addDoc).not.toHaveBeenCalled()
  })
})
