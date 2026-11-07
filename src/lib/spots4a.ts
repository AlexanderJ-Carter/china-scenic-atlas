import { computed, ref, shallowRef } from 'vue'
import { parse4ASpots } from '@/lib/parseSpots'
import { SPOTS_5A } from '@/data'
import type { Spot } from '@/types'

/**
 * 4A 全量数据运行时加载（public/data/spots-4a.json，~55KB gzip）。
 * 加载完成前页面仅显示 5A（不阻塞首屏）；失败静默降级并允许重试。
 */
export const spots4a = shallowRef<Spot[]>([])
export const loaded4a = ref(false)
export const loading4a = ref(false)
export const error4a = ref('')

let pending: Promise<void> | null = null

export function ensure4ALoaded(): Promise<void> {
  if (loaded4a.value) return Promise.resolve()
  if (!pending) {
    loading4a.value = true
    error4a.value = ''
    pending = (async () => {
      try {
        const res = await fetch(new URL('data/spots-4a.json', document.baseURI).href, {
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        spots4a.value = parse4ASpots(await res.json())
        loaded4a.value = true
      } catch (err) {
        error4a.value = '4A 数据加载失败，请重试'
        console.warn('[spots4a] 4A 数据加载失败，仅展示 5A', err)
        pending = null // 允许下次重试
      } finally {
        loading4a.value = false
      }
    })()
  }
  return pending
}

/** 全量景区（5A + 已加载的 4A），搜索/推荐等使用 */
export const allSpots = computed<Spot[]>(() => [...SPOTS_5A, ...spots4a.value])
