/**
 * Русское склонение существительного при числе.
 *
 * Наивное «одно / до пяти — а / остальное — ов» врёт на 11–14 и на всех
 * числах, оканчивающихся на 1: «11 устройства», «21 устройства».
 *
 * plural(1, 'устройство', 'устройства', 'устройств') → 'устройство'
 */
export function plural(count, one, few, many) {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return many
  if (tail === 1) return one
  if (tail >= 2 && tail <= 4) return few
  return many
}

// «1 устройство», «5 устройств» — вместе с самим числом.
export function withCount(count, one, few, many) {
  return `${count} ${plural(count, one, few, many)}`
}
