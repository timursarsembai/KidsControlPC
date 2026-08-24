// Заглушка: в Firebase-версии профилей детей нет.
//
// Там устройство и есть ребёнок, и переделывать боевую базу ради этого
// не нужно — панель сама покажет список устройств, если детей нет
// (см. supportsChildren в shared/data/children.js).
//
// Подписка отдаёт пустой список сразу же: без этого экран остался бы в
// состоянии загрузки навсегда.

export function subscribeToChildren(_uid, callback) {
  callback([])
  return () => {}
}

function unsupported() {
  throw new Error('Профили детей доступны только на собственном сервере.')
}

export const createChild = unsupported
export const updateChild = unsupported
export const deleteChild = unsupported
export const assignDevice = unsupported
