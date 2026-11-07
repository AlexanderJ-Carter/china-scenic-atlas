import type { DataMeta, Spot } from '@/types'
import spots5aRaw from './spots.json'
import metaRaw from './meta.json'

/**
 * 数据入口。5A 全量（361 条，~110KB）随包内联；
 * 4A 全量（~920 条）体量较大，改为运行时从 public/data/spots-4a.json
 * 按需加载（见 lib/spots4a.ts），初始 JS 体积不随 4A 扩充增长。
 */
export const SPOTS_5A = spots5aRaw as unknown as Spot[]
export const DATA_META = metaRaw as unknown as DataMeta

/** 类别固定展示顺序 */
export const CATEGORIES = [
  '文化遗产',
  '自然风光',
  '自然与文化双遗产',
  '红色旅游',
  '主题乐园',
  '博物馆',
  '园林景观',
  '现代建筑',
  '边境风情',
] as const
