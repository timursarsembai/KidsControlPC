import { describe, it, expect, vi, beforeEach } from 'vitest'

// Подписка подменяется целиком: проверяется поведение слайса, а не сеть.
const subscribeToChildren = vi.fn()
const createChild = vi.fn(async () => 'new-child')
const updateChild = vi.fn(async () => {})
const deleteChild = vi.fn(async () => {})
const assignDevice = vi.fn(async () => {})

vi.mock('../../data/children.js', () => ({
  supportsChildren: true,
  subscribeToChildren: (...args) => subscribeToChildren(...args),
  createChild: (...args) => createChild(...args),
  updateChild: (...args) => updateChild(...args),
  deleteChild: (...args) => deleteChild(...args),
  assignDevice: (...args) => assignDevice(...args)
}))

const { createChildrenSlice } = await import('./childrenSlice.js')

function makeStore(initial = {}) {
  let state = {}
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  state = {
    user: { uid: 'parent-1' },
    activeOwnerUid: 'owner-1',
    devices: [],
    selectedDeviceId: null,
    setShowSettings: vi.fn(),
    ...createChildrenSlice(set, get),
    ...initial
  }
  return { get, set }
}

beforeEach(() => {
  vi.clearAllMocks()
  subscribeToChildren.mockReturnValue(() => {})
})

describe('слайс профилей детей', () => {
  it('раскрывает профиль выбранного устройства, а не первый попавшийся', () => {
    const { get } = makeStore({
      devices: [{ id: 'd1', childId: 'c2' }],
      selectedDeviceId: 'd1'
    })
    get().initChildren()

    const push = subscribeToChildren.mock.calls[0][1]
    push([{ id: 'c1', name: 'Первый' }, { id: 'c2', name: 'Второй' }])

    expect(get().expandedChildId).toBe('c2')
  })

  // Список детей приходит заново при каждом изменении — в том числе когда
  // родитель правит соседний профиль. Раскрытый профиль не должен
  // схлопываться под курсором.
  it('не схлопывает раскрытый профиль при обновлении списка', () => {
    const { get } = makeStore()
    get().initChildren()
    const push = subscribeToChildren.mock.calls[0][1]

    push([{ id: 'c1', name: 'Первый' }, { id: 'c2', name: 'Второй' }])
    get().expandChild('c2')
    expect(get().expandedChildId).toBe('c2')

    push([{ id: 'c1', name: 'Первый' }, { id: 'c2', name: 'Второй, переименован' }])
    expect(get().expandedChildId).toBe('c2')
  })

  it('переключает раскрытие на удалённом профиле', () => {
    const { get } = makeStore()
    get().initChildren()
    const push = subscribeToChildren.mock.calls[0][1]

    push([{ id: 'c1', name: 'Первый' }, { id: 'c2', name: 'Второй' }])
    get().expandChild('c2')
    push([{ id: 'c1', name: 'Первый' }])

    expect(get().expandedChildId).toBe('c1')
  })

  it('снимает признак загрузки, даже когда детей нет', () => {
    const { get } = makeStore()
    expect(get().childrenLoading).toBe(true)
    get().initChildren()
    subscribeToChildren.mock.calls[0][1]([])
    expect(get().childrenLoading).toBe(false)
  })

  it('раскрывает только что созданный профиль', async () => {
    const { get } = makeStore()
    await get().addChild({ name: 'Айдана', avatar: '🦊' })
    expect(createChild).toHaveBeenCalledWith('owner-1', { name: 'Айдана', avatar: '🦊', note: undefined })
    expect(get().expandedChildId).toBe('new-child')
  })

  it('передаёт отвязку как пустой профиль, а не молча пропускает', async () => {
    const { get } = makeStore()
    await get().assignDeviceToChild('d1', null)
    expect(assignDevice).toHaveBeenCalledWith('owner-1', 'd1', null)
  })

  it('запоминает профиль, в котором нажали «добавить устройство»', () => {
    const { get } = makeStore()
    get().startAddDevice('c7')
    expect(get().pairingChildId).toBe('c7')
    expect(get().setShowSettings).toHaveBeenCalledWith(true)
  })

  it('отписывается и очищает состояние при выходе', () => {
    const unsub = vi.fn()
    subscribeToChildren.mockReturnValue(unsub)
    const { get } = makeStore()
    get().initChildren()
    subscribeToChildren.mock.calls[0][1]([{ id: 'c1', name: 'Первый' }])

    get().cleanupChildren()

    expect(unsub).toHaveBeenCalled()
    expect(get().children).toEqual([])
    expect(get().expandedChildId).toBe(null)
    expect(get().pairingChildId).toBe(null)
  })

  // Без пользователя подписка ушла бы с пустым владельцем и вернула чужой
  // или пустой список.
  it('не подписывается до входа', () => {
    const { get } = makeStore({ user: null })
    get().initChildren()
    expect(subscribeToChildren).not.toHaveBeenCalled()
  })
})
