import {
  assignDevice, createChild, deleteChild, subscribeToChildren, supportsChildren, updateChild
} from '../../data/children.js'
import { logger } from '../../utils/logger.js'

export const createChildrenSlice = (set, get) => ({
  children: [],
  childrenLoading: supportsChildren,
  // Какой профиль раскрыт в списке слева. Не то же самое, что выбранное
  // устройство: раскрыть профиль можно, ничего в нём не выбирая.
  expandedChildId: null,
  // Профиль, выбранный кнопкой «добавить устройство»: родитель нажал её
  // внутри профиля, а код привязки выдаётся уже в настройках — иначе выбор
  // терялся бы по дороге.
  pairingChildId: null,
  _unsubChildren: null,

  initChildren: () => {
    const { user, activeOwnerUid, _unsubChildren } = get()
    if (!user) return
    _unsubChildren?.()

    const unsub = subscribeToChildren(activeOwnerUid || user.uid, (children) => {
      const { expandedChildId, selectedDeviceId, devices } = get()

      // Раскрытым остаётся профиль выбранного устройства — иначе после
      // любого обновления списка он схлопывался бы под курсором.
      const deviceChildId = devices.find(d => d.id === selectedDeviceId)?.childId ?? null
      const stillThere = children.some(c => c.id === expandedChildId)
      const next = stillThere ? expandedChildId : (deviceChildId ?? children[0]?.id ?? null)

      set({ children, childrenLoading: false, expandedChildId: next })
    })

    set({ _unsubChildren: unsub })
  },

  cleanupChildren: () => {
    get()._unsubChildren?.()
    set({
      children: [],
      childrenLoading: supportsChildren,
      expandedChildId: null,
      pairingChildId: null,
      _unsubChildren: null
    })
  },

  startAddDevice: (childId = null) => {
    set({ pairingChildId: childId })
    get().setShowSettings(true)
  },

  expandChild: (childId) => {
    set({ expandedChildId: get().expandedChildId === childId ? null : childId })
  },

  addChild: async ({ name, avatar, note } = {}) => {
    const { user, activeOwnerUid } = get()
    if (!user) return null
    logger.info('general', `Создание профиля ребёнка: ${name}`)
    const id = await createChild(activeOwnerUid || user.uid, { name, avatar, note })
    set({ expandedChildId: id })
    return id
  },

  editChild: async (childId, updates) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    await updateChild(activeOwnerUid || user.uid, childId, updates)
  },

  removeChild: async (childId) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    logger.info('general', `Удаление профиля ребёнка ${childId}`)
    await deleteChild(activeOwnerUid || user.uid, childId)
  },

  // Перенос устройства между профилями — и отвязка, если childId пуст.
  assignDeviceToChild: async (deviceId, childId) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    logger.info('general', `Устройство ${deviceId} → профиль ${childId ?? 'без профиля'}`)
    await assignDevice(activeOwnerUid || user.uid, deviceId, childId)
  }
})
