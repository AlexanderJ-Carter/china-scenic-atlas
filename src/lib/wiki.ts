/**
 * 景区详情富数据（维基百科简介 + 代表配图），构建期抓取并本地化：
 * public/data/wiki.json（scripts/build-wiki.mjs 生成），运行时按需 fetch，
 * 不依赖网络。图片 URL 指向 upload.wikimedia.org（懒加载、加载失败自动
 * 降级为本地分类插画）。
 */

export interface WikiSummary {
  thumb?: string
  extract?: string
  url?: string
}

const cache = new Map<string, WikiSummary | null>()
let dataPromise: Promise<void> | null = null

function ensureWikiData(): Promise<void> {
  if (!dataPromise) {
    dataPromise = fetch(new URL('data/wiki.json', document.baseURI).href)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as Record<string, WikiSummary>
        for (const [k, v] of Object.entries(data)) cache.set(k, v)
      })
      .catch((err) => {
        console.warn('[wiki] 本地维基数据加载失败', err)
        dataPromise = null // 允许重试
      })
  }
  return dataPromise
}

/** 按景区名查本地维基数据（无词条返回 null，前端降级为分类插画） */
export async function fetchWikiSummary(name: string): Promise<WikiSummary | null> {
  await ensureWikiData()
  return cache.get(name) ?? null
}
