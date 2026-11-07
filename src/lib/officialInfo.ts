/**
 * 5A 景区官网/开放时间/门票信息（构建期收集自公开资料，
 * public/data/website-5a.json，懒加载）。
 */
export interface OfficialInfo {
  website?: string
  hours?: string
  ticketHint?: string
  confidence?: 'high' | 'medium' | 'low'
}

const cache = new Map<string, OfficialInfo>()
let dataPromise: Promise<void> | null = null

function ensureLoaded(): Promise<void> {
  if (!dataPromise) {
    dataPromise = fetch(new URL('data/website-5a.json', document.baseURI).href)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as Record<string, OfficialInfo>
        for (const [k, v] of Object.entries(data)) cache.set(k, v)
      })
      .catch((err) => {
        console.warn('[officialInfo] 官网数据加载失败', err)
        dataPromise = null
      })
  }
  return dataPromise
}

export async function getOfficialInfo(name: string): Promise<OfficialInfo | null> {
  await ensureLoaded()
  return cache.get(name) ?? null
}
