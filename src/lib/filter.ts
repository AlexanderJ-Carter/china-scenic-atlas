import { computed } from 'vue'
import { isVisited } from '@/lib/visited'
import { state } from '@/state'
import { SPOTS_5A } from '@/data'
import { spots4a } from '@/lib/spots4a'
import type { Spot } from '@/types'

export const UNKNOWN_CATEGORY = '未分类'

/** 类别选项使用未应用类别筛选的基数，便于直接切换。 */
export const categoryBaseSpots = computed<Spot[]>(() => {
  const base = [...SPOTS_5A, ...(state.levels['4A'] ? spots4a.value : [])]
  return base.filter(
    (s) =>
      state.levels[s.level] &&
      (state.visitFilter === 'all' ||
        (state.visitFilter === 'visited' ? isVisited(s.name) : !isVisited(s.name))) &&
      (s.year == null ? state.includeUnknownYear : s.year <= state.yearMax),
  )
})

export const visibleSpots = computed(() =>
  categoryBaseSpots.value.filter(
    (s) => !state.category || (s.category || UNKNOWN_CATEGORY) === state.category,
  ),
)

export const currentSpots = computed(() => {
  const view = state.view
  return view.mode === 'national'
    ? visibleSpots.value
    : visibleSpots.value.filter((s) => s.province === view.short)
})

/** 全体 5A / 4A 数量（KPI 与徽章展示基准） */
export const total5A = SPOTS_5A.filter((s) => s.level === '5A').length
export const total4A = computed(() => spots4a.value.length)
