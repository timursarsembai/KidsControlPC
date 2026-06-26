// Storage plan definitions. quotaBytes is enforced in Firestore (storageQuotaBytes field).
// When a payment provider is connected, it updates storageQuotaBytes + storagePlan
// on the user's profile/data document after a successful purchase.

export const PLANS = {
  free: {
    id: 'free',
    name: 'Бесплатный',
    quotaBytes: 100 * 1024 * 1024,   // 100 МБ
    price: 0,
    currency: 'KZT',
    fileTtlDays: 7,
  },
  basic: {
    id: 'basic',
    name: 'Базовый',
    quotaBytes: 500 * 1024 * 1024,   // 500 МБ
    price: 490,
    currency: 'KZT',
    fileTtlDays: 30,
  },
  standard: {
    id: 'standard',
    name: 'Стандартный',
    quotaBytes: 1 * 1024 * 1024 * 1024,  // 1 ГБ
    price: 890,
    currency: 'KZT',
    fileTtlDays: 90,
  },
  pro: {
    id: 'pro',
    name: 'Про',
    quotaBytes: 2 * 1024 * 1024 * 1024,  // 2 ГБ
    price: 1490,
    currency: 'KZT',
    fileTtlDays: null,   // без ограничения по сроку
  },
}

export const DEFAULT_PLAN = PLANS.free
