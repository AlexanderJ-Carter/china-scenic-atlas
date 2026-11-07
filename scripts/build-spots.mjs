#!/usr/bin/env node
/**
 * 构建 5A 景区数据集 src/data/spots.json + src/data/meta.json。
 *
 * 流程：
 *   1. 拉取 aeryzhao/AAAAA 的 spots.json（354 条，含高德 GCJ-02 坐标/简介/分类）
 *   2. 拉取中文维基百科《国家5A级旅游景区》wikitext，解析出官方名录（含摘牌/恢复）
 *   3. 应用 scripts/patches-5a.json 人工核对补丁（增/删/改名/匹配映射）
 *   4. 与维基名录做名称匹配，采用维基公告日期为权威评级年份
 *   5. 人工补录条目的 WGS84 坐标转换为 GCJ-02（与 DataV 底图坐标系一致）
 *   6. 港澳条目标记非官方评定
 *
 * 缓存：.data-cache/（--refresh 强制重新拉取）
 * 用法：npm run data:spots [-- --refresh]
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import patches from './patches-5a.json' with { type: 'json' }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = resolve(ROOT, '.data-cache')

const URL_AERY = 'https://raw.githubusercontent.com/aeryzhao/AAAAA/main/data/spots.json'
const URL_WIKI = `https://zh.wikipedia.org/wiki/${encodeURIComponent('国家5A级旅游景区')}?action=raw`

const REFRESH = process.argv.includes('--refresh')

/* ---------------- 工具 ---------------- */

const PROV_FULL_TO_SHORT = {
  北京市: '北京',
  天津市: '天津',
  河北省: '河北',
  山西省: '山西',
  内蒙古自治区: '内蒙古',
  辽宁省: '辽宁',
  吉林省: '吉林',
  黑龙江省: '黑龙江',
  上海市: '上海',
  江苏省: '江苏',
  浙江省: '浙江',
  安徽省: '安徽',
  福建省: '福建',
  江西省: '江西',
  山东省: '山东',
  河南省: '河南',
  湖北省: '湖北',
  湖南省: '湖南',
  广东省: '广东',
  广西壮族自治区: '广西',
  海南省: '海南',
  重庆市: '重庆',
  四川省: '四川',
  贵州省: '贵州',
  云南省: '云南',
  西藏自治区: '西藏',
  陕西省: '陕西',
  甘肃省: '甘肃',
  青海省: '青海',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
}

/**
 * 带缓存的拉取。as 指定期望格式（wikitext 等纯文本源必须传 'text'，
 * 否则缓存命中时 JSON.parse 抛错会被静默吞掉、缓存永远失效）。
 * 网络失败时若存在旧缓存则降级复用（警告）。
 */
async function cachedFetch(url, name, as = 'json') {
  const file = resolve(CACHE, name)
  const readCache = async () =>
    as === 'text' ? await readFile(file, 'utf-8') : JSON.parse(await readFile(file, 'utf-8'))
  try {
    if (!REFRESH) {
      const info = await stat(file)
      // 7 天内的缓存直接复用
      if (Date.now() - info.mtimeMs < 7 * 24 * 3600 * 1000) {
        return await readCache()
      }
    }
  } catch {
    /* 无缓存或缓存损坏 */
  }
  let text
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'china-scenic-map/build-spots (dataset build script)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    text = await res.text()
  } catch (err) {
    // 离线降级：使用旧缓存
    try {
      console.warn(`  ⚠ 拉取失败（${err.message}），复用旧缓存 ${name}`)
      return await readCache()
    } catch {
      throw err
    }
  }
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, text)
  return as === 'text' ? text : safeParse(text)
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/* ---------------- WGS84 -> GCJ02 ---------------- */

const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function wgs2gcj(lng, lat) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lng, lat]
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

/* ---------------- 维基百科解析 ---------------- */

function cleanCell(cell) {
  let s = cell
  s = s.replace(/<ref[^>]*\/>/g, '')
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  s = s.replace(/<br\s*\/?>/g, '\n')
  s = s.replace(/<\/?s>/g, '')
  s = s.replace(/\[\[(?:[^|[\]]*\|)?([^\]]+)\]\]/g, '$1')
  s = s.replace(/'''/g, '').replace(/''/g, '')
  s = s.replace(/<[^>]+>/g, '')
  return s.trim()
}

/**
 * 解析维基 wikitext 表格 → 条目列表
 * 行结构：省级行政区(rowspan) | 个数 | 地级行政区 | 县级行政区 | 景点名称 | 批次日期
 */
function parseWiki(text) {
  const rows = []
  let curProv = null
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const pm = line.match(/^!\s+rowspan="\d+"[^|]*\|\s*(.*)$/)
    if (pm) {
      curProv = cleanCell(pm[1])
      continue
    }
    if (line.startsWith('|') && !line.startsWith('|-') && !line.startsWith('|}')) {
      const nameCell = line.slice(1).trim()
      const next = lines[i + 1] ?? ''
      const dm = next.match(/^\|\s*([12]\d{3})\/\d{2}\/\d{2}/)
      if (dm && nameCell && !/^[12]\d{3}\//.test(nameCell)) {
        const name = cleanCell(nameCell).split('\n')[0]
        const dateInfo = cleanCell(next.slice(1))
        const events = [...dateInfo.matchAll(/([12]\d{3})(取消|恢复)/g)]
        const struck = line.includes('<s>') || next.includes('<s>')
        let active = true
        if (events.length) {
          active = events[events.length - 1][2] === '恢复' && !struck
        } else if (struck) {
          active = false
        }
        rows.push({
          name,
          province: curProv ? (PROV_FULL_TO_SHORT[curProv] ?? curProv) : null,
          year: parseInt(dm[1], 10),
          active,
          // 括号中的组合名（如「八达岭-慕田峪长城」），用于展示，不参与主名称匹配
          group: nameCell.match(/[（(]([^）)]+)[）)]/)?.[1] ?? null,
        })
        i++
        continue
      }
    }
  }
  return rows
}

/* ---------------- 名称匹配 ---------------- */

const SUFFIXES = [
  '生态文化旅游区',
  '生态旅游示范区',
  '文化生态旅游区',
  '文化旅游区',
  '历史文化景区',
  '风景名胜区',
  '风景旅游区',
  '旅游度假区',
  '旅游风景区',
  '旅游区',
  '度假区',
  '度假世界',
  '风景区',
  '大景区',
  '景区',
  '博物院',
  '博物馆',
  '公园',
  '旅游城',
  '影视城',
]

function cjkOnly(s) {
  return s.replace(/[^一-鿿]/g, '')
}

function stripSuffixes(s) {
  for (let round = 0; round < 2; round++) {
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= 2) {
        s = s.slice(0, -suf.length)
        break
      }
    }
  }
  return s
}

function normalizeName(name, cityPrefix) {
  // 去掉括号内容、非中文字符
  let s = cjkOnly(name.replace(/[（(][^）)]*[）)]/g, ''))
  // 去掉城市前缀（aeryzhao 命名习惯为「城市+景区」），保留至少 4 字避免「黄山风景区→风景区」
  if (cityPrefix) {
    const c = cjkOnly(cityPrefix)
    if (c && s.startsWith(c) && s.length - c.length >= 4) {
      s = s.slice(c.length)
    }
  }
  return stripSuffixes(s)
}

/** 字符二元组 Dice 相似度（对中文景区名效果较好） */
function bigramDice(a, b) {
  if (a.length < 2 || b.length < 2) return 0
  const grams = (s) => {
    const m = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const ga = grams(a)
  const gb = grams(b)
  let common = 0
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0)
  return (2 * common) / (ga.size + gb.size)
}

/** 匹配打分：越大越可信（同省内比较） */
function matchScore(aeryNorm, wikiNorm) {
  if (!aeryNorm || !wikiNorm) return 0
  if (aeryNorm === wikiNorm) return 100
  if (wikiNorm.includes(aeryNorm)) return 60 + aeryNorm.length
  if (aeryNorm.includes(wikiNorm)) return 50 + wikiNorm.length
  // 前缀关系（如 圆明园 / 圆明园遗址），较短一方至少 3 字
  const shorter = aeryNorm.length < wikiNorm.length ? aeryNorm : wikiNorm
  const longer = shorter === aeryNorm ? wikiNorm : aeryNorm
  if (shorter.length >= 3 && longer.startsWith(shorter)) return 45 + shorter.length
  const dice = bigramDice(aeryNorm, wikiNorm)
  if (dice >= 0.55) return 40 + dice * 20
  return 0
}

/* ---------------- 4A 全量数据 ---------------- */

/**
 * 4A 数据集已由 scripts/build-4a-full.mjs 独立构建
 * （维基百科各省分类 + 坐标 + 精选合并 → public/data/spots-4a.json）。
 * 本脚本仅负责在 meta.json 中保留其计数与说明（若已构建）。
 */
async function carry4AMeta() {
  try {
    const old = JSON.parse(await readFile(resolve(ROOT, 'src/data/meta.json'), 'utf-8'))
    return {
      spotCount4A: old.spotCount4A ?? 0,
      notes: (old.notes ?? []).filter((n) => typeof n === 'string' && n.startsWith('4A')),
    }
  } catch {
    return { spotCount4A: 0, notes: [] }
  }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  console.log('拉取源数据 …')
  const [aeryRaw, wikiText] = await Promise.all([
    cachedFetch(URL_AERY, 'aeryzhao-spots.json'),
    cachedFetch(URL_WIKI, 'wiki-5a.txt', 'text'),
  ])

  // 维基名录解析护栏：页面结构变化时中止，防止静默产出退化数据
  const wikiRowsEarly = parseWiki(wikiText)
  if (wikiRowsEarly.length < 300) {
    throw new Error(
      `维基名录解析异常：仅 ${wikiRowsEarly.length} 行（预期 350+），` +
        '疑似页面结构变化。请检查 zh.wikipedia.org/wiki/国家5A级旅游景区 的表格格式后修正解析器。',
    )
  }

  // 1. 应用补丁：改名 → 删除 → 简介修正
  const spots = aeryRaw.map((s) => ({ ...s }))
  for (const [from, patch] of Object.entries(patches.renames ?? {})) {
    const hit = spots.find((s) => s.name === from)
    if (hit) hit.name = patch.to ?? patch
  }
  for (const rm of patches.removes ?? []) {
    const name = typeof rm === 'string' ? rm : rm.name
    const idx = spots.findIndex((s) => s.name === name)
    if (idx >= 0) spots.splice(idx, 1)
    else console.warn(`  ⚠ 待删除条目未找到: ${name}`)
  }
  for (const [name, patch] of Object.entries(patches.descOverrides ?? {})) {
    const hit = spots.find((s) => s.name === name)
    if (hit) hit.desc = patch.desc ?? patch
  }

  // 1.5 坐标修正（海岸/岛屿/界河条目的精度修正，见 patches-5a.json coordFixes）
  for (const [name, fix] of Object.entries(patches.coordFixes ?? {})) {
    const hit = spots.find((s) => s.name === name)
    if (hit) {
      hit.lng = fix.lng
      hit.lat = fix.lat
    } else {
      console.warn(`  ⚠ 坐标修正目标未找到: ${name}`)
    }
  }

  // 2. 补录缺失条目（WGS84 → GCJ-02）
  for (const add of patches.adds ?? []) {
    const [lng, lat] = wgs2gcj(add.lng, add.lat)
    spots.push({
      name: add.name,
      province: add.province,
      city: add.city,
      year: add.year,
      category: add.category,
      desc: add.desc,
      lng: Math.round(lng * 1000) / 1000,
      lat: Math.round(lat * 1000) / 1000,
      coordSource: '人工核对补录（WGS84→GCJ-02）',
    })
  }

  // 3. 与维基名录匹配，采用公告年份
  const wikiRows = parseWiki(wikiText)
  const wikiActive = wikiRows.filter((r) => r.active)
  const wikiRemoved = wikiRows.filter((r) => !r.active)
  console.log(
    `维基名录：共 ${wikiRows.length} 行，在册 ${wikiActive.length} 行，摘牌 ${wikiRemoved.length} 行`,
  )

  const overrides = patches.matchOverrides ?? {}
  const usedWiki = new Set()
  const unmatched = []
  let yearFixed = 0

  for (const s of spots) {
    let best = null
    let bestScore = 0
    const overrideTarget = overrides[s.name]
    for (const w of wikiActive) {
      if (w.province !== s.province) continue
      let score
      if (overrideTarget && w.name === overrideTarget) {
        score = 999
      } else {
        score = matchScore(normalizeName(s.name, s.city), normalizeName(w.name))
      }
      if (score > bestScore) {
        bestScore = score
        best = w
      }
    }
    if (best && bestScore >= 45 && !usedWiki.has(best)) {
      usedWiki.add(best)
      if (best.year !== s.year) {
        console.log(`  年份修正: ${s.name} ${s.year} → ${best.year}（${best.name} 公告日期）`)
        yearFixed++
        s.year = best.year
      }
    } else {
      unmatched.push(s)
    }
  }

  const wikiUnmatched = wikiActive.filter((w) => !usedWiki.has(w))
  if (unmatched.length) {
    console.log(
      `\n⚠ 未能与维基名录匹配的条目 ${unmatched.length} 个（保留源数据年份，建议人工核对）:`,
    )
    for (const s of unmatched) console.log(`   - ${s.province} ${s.name} (${s.year})`)
  }
  if (wikiUnmatched.length) {
    console.log(
      `\nℹ 维基名录中未被匹配的行 ${wikiUnmatched.length} 个（多为联合评定的子条目，属正常）:`,
    )
    for (const w of wikiUnmatched.slice(0, 15))
      console.log(`   - ${w.province} ${w.name} (${w.year})`)
    if (wikiUnmatched.length > 15) console.log(`   … 等共 ${wikiUnmatched.length} 行`)
  }

  // 4. 港澳：非文旅部评定，标记为参考收录（无评定年份）
  for (const s of spots) {
    if (s.province === '香港' || s.province === '澳门') {
      s.official = false
      s.year = null
      s.note = '港澳景区无 A 级评定体系，为参照 5A 水准的参考收录'
    } else {
      s.official = true
    }
  }

  // 5. 排序与输出
  spots.sort((a, b) => a.province.localeCompare(b.province, 'zh') || a.year - b.year)
  const out = spots.map((s) => ({
    name: s.name,
    level: '5A',
    province: s.province,
    city: s.city,
    year: s.year,
    category: s.category,
    desc: s.desc,
    lng: s.lng,
    lat: s.lat,
    official: s.official,
    ...(s.note ? { note: s.note } : {}),
    ...(s.coordSource ? { coordSource: s.coordSource } : {}),
  }))
  await writeFile(resolve(ROOT, 'src/data/spots.json'), JSON.stringify(out))

  // 6. meta：保留已构建的 4A 计数与说明（4A 数据集见 build-4a-full.mjs）
  const carried = await carry4AMeta()
  const mainlandCount = out.filter((s) => s.official).length
  const meta = {
    generatedAt: new Date().toISOString(),
    spotCount5A: out.length,
    mainland5A: mainlandCount,
    spotCount4A: carried.spotCount4A,
    sources: [
      {
        name: '文化和旅游部 5A 评定公告（政务公开）',
        url: 'https://zwgk.mct.gov.cn/zfxxgkml/zykf/',
      },
      {
        name: '维基百科《国家5A级旅游景区》',
        url: 'https://zh.wikipedia.org/wiki/国家5A级旅游景区',
      },
      {
        name: '维基百科各省 4A 景区分类（4A 数据来源）',
        url: 'https://zh.wikipedia.org/wiki/Category:4A级旅游景区',
      },
      { name: 'aeryzhao/AAAAA（坐标与简介底稿）', url: 'https://github.com/aeryzhao/AAAAA' },
      {
        name: '阿里云 DataV.GeoAtlas（地图边界）',
        url: 'https://datav.aliyun.com/portal/school/atlas/area_selector',
      },
    ],
    notes: [
      '5A 名单经文旅部公告与维基百科双重核对；年份采用官方公告日期口径',
      `年份修正 ${yearFixed} 处；补录 ${patches.adds?.length ?? 0} 条；剔除误收 ${(patches.removes ?? []).length} 条`,
      '港澳 2 条为非官方参考收录（已在详情中标注）',
      '黄河壶口瀑布旅游区为晋陕联合评定，仅保留一条（记于山西）',
      ...carried.notes,
    ],
  }
  await writeFile(resolve(ROOT, 'src/data/meta.json'), JSON.stringify(meta, null, 2))

  console.log(
    `\n完成：src/data/spots.json — ${out.length} 条（其中大陆官方评定 ${mainlandCount} 条）`,
  )
  console.log(
    `      src/data/meta.json 已生成（4A 计数 ${carried.spotCount4A} 由 build-4a-full.mjs 维护）`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
