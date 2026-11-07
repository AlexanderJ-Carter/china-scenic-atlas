import { reactive } from 'vue'
import { SPOTS_5A } from '@/data'
import type { Spot, View } from '@/types'

export interface AppState {
  /** 当前视图（全国 / 省级行政区聚焦） */
  view: View
  /** 等级筛选 */
  levels: Record<'5A' | '4A', boolean>
  /** 底图模式：统计 choropleth / 地形 */
  mapMode: 'stat' | 'terrain'
  /** 年份滑块：只展示评级年份 <= yearMax 的景区 */
  yearMax: number
  includeUnknownYear: boolean
  visitFilter: 'all' | 'visited' | 'unvisited'
  /** 类别筛选（null = 全部） */
  category: string | null
  /** 搜索关键词 */
  query: string
  /** 选中的景区（详情抽屉） */
  selectedSpot: Spot | null
  /** 年份演进动画播放中 */
  playing: boolean
}

export const MIN_YEAR = 2007
/** 数据集中最新的评级年份（避免滑块出现无变化的空档） */
export const MAX_YEAR = Math.max(...SPOTS_5A.map((s: Spot) => s.year ?? MIN_YEAR))

export const state = reactive<AppState>({
  view: { mode: 'national' },
  // 默认仅显示 5A：4A 体量大（1100+ 点），按需开启更聚焦
  levels: { '5A': true, '4A': false },
  mapMode: 'stat',
  yearMax: MAX_YEAR,
  includeUnknownYear: true,
  visitFilter: 'all',
  category: null,
  query: '',
  selectedSpot: null,
  playing: false,
})

/** 恢复筛选，不改变当前省份或底图。 */
export function resetFilters(): void {
  state.levels = { '5A': true, '4A': false }
  state.yearMax = MAX_YEAR
  state.includeUnknownYear = true
  state.visitFilter = 'all'
  state.category = null
  state.playing = false
  state.query = ''
}
