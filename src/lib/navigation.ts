import { isVisited } from '@/lib/visited'
import { state } from '@/state'
import { PROVINCES } from '@/data/provinces'
import type { Spot } from '@/types'

/** 定位前确保目标不会被当前筛选隐藏。 */
export function locateSpot(spot: Spot): void {
  state.playing = false
  if (
    (state.visitFilter === 'visited' && !isVisited(spot.name)) ||
    (state.visitFilter === 'unvisited' && isVisited(spot.name))
  )
    state.visitFilter = 'all'
  state.levels[spot.level] = true
  if (spot.year == null) state.includeUnknownYear = true
  else state.yearMax = Math.max(state.yearMax, spot.year)
  if (state.category && state.category !== (spot.category || '未分类')) state.category = null
  const province = PROVINCES.find((p) => p.short === spot.province)
  if (province && province.adcode !== 710000) {
    state.view = {
      mode: 'province',
      adcode: province.adcode,
      short: province.short,
      full: province.full,
      kind: province.kind,
    }
  }
}
