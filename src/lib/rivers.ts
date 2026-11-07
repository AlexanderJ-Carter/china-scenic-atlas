import { reactive } from 'vue'

/**
 * 河流线数据懒加载（public/data/rivers.json，Natural Earth 裁剪）。
 * 地貌模式启用时由 MapPanel 触发加载。
 */
export type RiversData = Record<string, [number, number][][]>

const state = reactive<{ data: RiversData; loaded: boolean }>({ data: {}, loaded: false })
let pending: Promise<void> | null = null

export function ensureRiversLoaded(): Promise<void> {
  if (state.loaded) return Promise.resolve()
  if (!pending) {
    pending = fetch(new URL('data/rivers.json', document.baseURI).href)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        state.data = (await res.json()) as RiversData
        state.loaded = true
      })
      .catch((err) => {
        console.warn('[rivers] 河流数据加载失败', err)
        pending = null
      })
  }
  return pending
}

/** 当前已加载的河流数据（地貌模式构建 option 时读取） */
export function getRivers(): RiversData {
  return state.data
}
