import {
  subscribeToChats,
  createChat,
  updateChat,
  deleteChat,
  sendMessage,
  subscribeToMessages
} from '../../firebase/chats.repo.js'

export const createChatSlice = (set, get) => ({
  chats: [],
  activeChatId: null,
  chatMessages: [],
  chatsLoading: false,
  _unsubChats: null,
  _unsubMessages: null,

  initChats: () => {
    const { user, activeOwnerUid, _unsubChats } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    _unsubChats?.()
    set({ chatsLoading: true })
    const unsub = subscribeToChats(ownerUid, (chats) => {
      set({ chats, chatsLoading: false })
    })
    set({ _unsubChats: unsub })
  },

  cleanupChats: () => {
    const { _unsubChats, _unsubMessages } = get()
    _unsubChats?.()
    _unsubMessages?.()
    set({ chats: [], activeChatId: null, chatMessages: [], _unsubChats: null, _unsubMessages: null })
  },

  selectChat: (chatId) => {
    const { user, activeOwnerUid, _unsubMessages } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    _unsubMessages?.()

    if (!chatId) {
      set({ activeChatId: null, chatMessages: [], _unsubMessages: null })
      return
    }

    set({ activeChatId: chatId, chatMessages: [] })
    const unsub = subscribeToMessages(ownerUid, chatId, (msgs) => {
      set({ chatMessages: msgs })
    })
    set({ _unsubMessages: unsub })
  },

  createGroupChat: async (name, deviceIds) => {
    const { user, activeOwnerUid, devices } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    const parentUids = await get()._getAllParentUids(ownerUid)
    return createChat(ownerUid, { type: 'group', name, deviceIds, parentUids })
  },

  createDirectChat: async (deviceId, deviceName) => {
    const { user, activeOwnerUid, chats } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    const existing = chats.find(c => c.type === 'direct' && c.deviceIds.includes(deviceId))
    if (existing) return existing.id
    const parentUids = await get()._getAllParentUids(ownerUid)
    return createChat(ownerUid, { type: 'direct', name: deviceName, deviceIds: [deviceId], parentUids })
  },

  _getAllParentUids: async (ownerUid) => {
    return [ownerUid]
  },

  updateGroupChat: async (chatId, updates) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    await updateChat(ownerUid, chatId, updates)
  },

  deleteGroupChat: async (chatId) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    await deleteChat(ownerUid, chatId)
    if (get().activeChatId === chatId) get().selectChat(null)
  },

  sendChatMessage: async (chatId, { text, gifUrl, gifPreviewUrl }) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    const senderName = user.displayName || user.email?.split('@')[0] || 'Родитель'
    await sendMessage(ownerUid, chatId, {
      text,
      gifUrl,
      gifPreviewUrl,
      senderType: 'parent',
      senderUid: user.uid,
      senderName
    })
  },

  getChatUnreadCount: (chatId) => {
    // unread for web (parent) — messages from children not read by this parent uid
    // For simplicity we just count messages from children (senderType=child)
    // A proper implementation would track readBy[parentUid], skipping for now
    return 0
  }
})
