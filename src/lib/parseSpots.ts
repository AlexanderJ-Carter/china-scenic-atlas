import type { Spot } from '@/types'

/** 拒绝损坏的数据文件，避免一次错误响应污染全局地图状态。 */
export function parse4ASpots(value: unknown): Spot[] {
  if (!Array.isArray(value) || !value.length) throw new Error('4A 数据不是有效景区数组')
  const names = new Set<string>()
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('景区条目无效')
    const s = item as Record<string, unknown>
    if (
      typeof s.name !== 'string' ||
      !s.name.trim() ||
      names.has(s.name) ||
      s.level !== '4A' ||
      typeof s.province !== 'string' ||
      !s.province ||
      typeof s.city !== 'string' ||
      typeof s.official !== 'boolean' ||
      (s.category != null && typeof s.category !== 'string') ||
      (s.year !== null && (typeof s.year !== 'number' || !Number.isInteger(s.year))) ||
      typeof s.lng !== 'number' ||
      !Number.isFinite(s.lng) ||
      Math.abs(s.lng) > 180 ||
      typeof s.lat !== 'number' ||
      !Number.isFinite(s.lat) ||
      Math.abs(s.lat) > 90 ||
      ['desc', 'note', 'coordSource'].some((key) => s[key] != null && typeof s[key] !== 'string')
    )
      throw new Error('4A 景区字段无效或名称重复')
    names.add(s.name)
    return { ...s, category: s.category || '' } as unknown as Spot
  })
}
