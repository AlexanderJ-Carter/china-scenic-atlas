#!/usr/bin/env node
/**
 * 构建中国主要河流线数据 public/data/rivers.json。
 *
 * 来源：Natural Earth 10m rivers（公有领域），裁剪中国范围 + 抽稀（每条 ~120 点）。
 * 匹配规则：name_en 精确匹配干流名称（避免汉江 Han 误匹配韩国河流——
 * 附加中国 bbox 内线段比例约束）。
 * 用法：node scripts/build-rivers.mjs
 */
import { writeFile, readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson'

/** 河流名 → 中文名（name_en 精确匹配） */
const RIVERS = [
  { names: ['Chang Jiang', 'Yangtze', 'Jinsha', 'Tongtian'], zh: '长江' },
  { names: ['Huang He', 'Huang'], zh: '黄河' },
  { names: ['Pearl', 'Xi Jiang', 'Xi'], zh: '珠江' },
  { names: ['Amur', 'Heilong Jiang', 'Argun', 'Songhua', 'Ussuri'], zh: '黑龙江' },
  { names: ['Tarim'], zh: '塔里木河' },
  { names: ['Mekong'], zh: '澜沧江' },
  { names: ['Nu'], zh: '怒江' },
  { names: ['Yarlung Tsangpo', 'Yarlung', 'Brahmaputra'], zh: '雅鲁藏布江' },
  { names: ['Huai'], zh: '淮河' },
  { names: ['Liao'], zh: '辽河' },
  { names: ['Yalong'], zh: '雅砻江' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('下载 Natural Earth 10m rivers …')
  let geo
  const cache = resolve(ROOT, '.data-cache/ne-rivers.geojson')
  try {
    geo = JSON.parse(await readFile(cache, 'utf-8'))
    console.log('  使用缓存')
  } catch {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(SRC, {
        headers: { 'User-Agent': 'china-scenic-map/1.0 (data build script)' },
        signal: AbortSignal.timeout(120000),
      })
      if (res.ok) {
        const text = await res.text()
        await mkdir(resolve(ROOT, '.data-cache'), { recursive: true })
        await writeFile(cache, text)
        geo = JSON.parse(text)
        break
      }
      await sleep(3000 * (attempt + 1))
    }
  }
  if (!geo) throw new Error('下载失败')
  console.log(`  河流线总数 ${geo.features.length}`)

  // 中国范围（含黑龙江/雅鲁藏布江出境段的一小段）
  const CN = { w: 73, e: 136, s: 17, n: 54 }

  const out = {}
  for (const { names, zh } of RIVERS) {
    const segs = []
    for (const f of geo.features) {
      const nameEn = f.properties?.name_en ?? ''
      if (!names.includes(nameEn)) continue
      const lines =
        f.geometry?.type === 'LineString'
          ? [f.geometry.coordinates]
          : (f.geometry?.coordinates ?? [])
      for (const line of lines) {
        const cn = line.filter((c) => c[0] >= CN.w && c[0] <= CN.e && c[1] >= CN.s && c[1] <= CN.n)
        if (cn.length >= 10) {
          const step = Math.max(1, Math.floor(cn.length / 120))
          segs.push(
            cn
              .filter((_, i) => i % step === 0 || i === cn.length - 1)
              .map((c) => [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]),
          )
        }
      }
    }
    if (segs.length) out[zh] = segs
  }
  const total = Object.values(out).flat().length
  await mkdir(resolve(ROOT, 'public/data'), { recursive: true })
  await writeFile(resolve(ROOT, 'public/data/rivers.json'), JSON.stringify(out))
  console.log(
    `完成：public/data/rivers.json — ${Object.keys(out).length} 条河流 ${total} 段（${(JSON.stringify(out).length / 1024).toFixed(0)} KB）`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
