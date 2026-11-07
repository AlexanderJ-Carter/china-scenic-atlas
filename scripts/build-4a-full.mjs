#!/usr/bin/env node
/**
 * 构建 4A 全量数据集 public/data/spots-4a.json。
 *
 * 来源：中文维基百科各省级行政区「国家4A级旅游景区」分类（MediaWiki API）
 *   1. categorymembers 枚举各省分类下的词条（4A 无国家统一名录，维基分类是目前
 *      最好的机器可读聚合，覆盖 ~1300 条；官方口径分散于 31 个省文旅厅公告）
 *   2. prop=coordinates 批量查询词条坐标（WGS84 → GCJ-02 转换）
 *   3. 与 scripts/patches-4a.json 的精选条目合并（精选字段优先：简介/类别/年份）
 *   4. 城市级归属用省边界 GeoJSON 点在多边形内推导
 *   5. 无坐标词条剔除并记录（地图无法定位）
 *
 * 速率：请求间隔 ~350ms + 429 退避重试。
 * 用法：node scripts/build-4a-full.mjs [--refresh]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import patches4A from './patches-4a.json' with { type: 'json' }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://zh.wikipedia.org/w/api.php'
const REFRESH = process.argv.includes('--refresh')
const UA = 'china-scenic-map/1.0 (open-source scenic map; dataset build script)'

const PROVS = [
  ['北京市', '北京', 110000],
  ['天津市', '天津', 120000],
  ['河北省', '河北', 130000],
  ['山西省', '山西', 140000],
  ['内蒙古自治区', '内蒙古', 150000],
  ['辽宁省', '辽宁', 210000],
  ['吉林省', '吉林', 220000],
  ['黑龙江省', '黑龙江', 230000],
  ['上海市', '上海', 310000],
  ['江苏省', '江苏', 320000],
  ['浙江省', '浙江', 330000],
  ['安徽省', '安徽', 340000],
  ['福建省', '福建', 350000],
  ['江西省', '江西', 360000],
  ['山东省', '山东', 370000],
  ['河南省', '河南', 410000],
  ['湖北省', '湖北', 420000],
  ['湖南省', '湖南', 430000],
  ['广东省', '广东', 440000],
  ['广西壮族自治区', '广西', 450000],
  ['海南省', '海南', 460000],
  ['重庆市', '重庆', 500000],
  ['四川省', '四川', 510000],
  ['贵州省', '贵州', 520000],
  ['云南省', '云南', 530000],
  ['西藏自治区', '西藏', 540000],
  ['陕西省', '陕西', 610000],
  ['甘肃省', '甘肃', 620000],
  ['青海省', '青海', 630000],
  ['宁夏回族自治区', '宁夏', 640000],
  ['新疆维吾尔自治区', '新疆', 650000],
]

/* ---------------- API 客户端（限速 + 重试） ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

async function api(params, attempt = 0, endpoint = API) {
  const url = `${endpoint}?${new URLSearchParams(params)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.status === 429) {
      if (attempt >= 6) throw new Error('多次 429 退避后仍被限流')
      await sleep(4000 * (attempt + 1))
      return api(params, attempt + 1, endpoint)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error.info)
    return data
  } catch (e) {
    if (attempt >= 4 || String(e.message).includes('429')) throw e
    await sleep(1500 * (attempt + 1))
    return api(params, attempt + 1, endpoint)
  }
}

/** 枚举一个分类下的全部主命名空间词条 */
async function categoryMembers(catTitle) {
  const titles = []
  let cont = null
  for (let page = 0; page < 5; page++) {
    const data = await api({
      action: 'query',
      list: 'categorymembers',
      format: 'json',
      cmtitle: catTitle,
      cmlimit: '500',
      cmnamespace: '0',
      ...(cont ? { cmcontinue: cont } : {}),
    })
    titles.push(...(data.query?.categorymembers ?? []).map((m) => m.title))
    cont = data.continue?.cmcontinue ?? null
    if (!cont) break
    await sleep(600)
  }
  return titles
}

/** 批量查询词条坐标（每批 50 个） */
async function fetchCoordinates(titles) {
  const byTitle = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const data = await api({
      action: 'query',
      prop: 'coordinates',
      format: 'json',
      colimit: '50',
      coprimary: 'primary',
      redirects: '1',
      titles: batch.join('|'),
    })
    for (const page of Object.values(data.query?.pages ?? {})) {
      const coords = page.coordinates?.[0]
      if (coords) byTitle.set(page.title, { lat: coords.lat, lng: coords.lon })
    }
    await sleep(600)
  }
  return byTitle
}

/* ---------------- Wikidata 坐标补全 ---------------- */

/** 词条 → Wikidata QID（每批 50 个，经 pageprops） */
async function fetchWikidataQids(titles) {
  const byTitle = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const data = await api({
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      format: 'json',
      redirects: '1',
      titles: batch.join('|'),
    })
    for (const page of Object.values(data.query?.pages ?? {})) {
      const qid = page.pageprops?.wikibase_item
      if (qid) byTitle.set(page.title, qid)
    }
    await sleep(600)
  }
  return byTitle
}

/** QID → P625 坐标（每批 50 个） */
async function fetchWikidataCoords(qids) {
  const byQid = new Map()
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50)
    const data = await api(
      { action: 'wbgetentities', ids: batch.join('|'), props: 'claims', format: 'json' },
      0,
      WIKIDATA_API,
    )
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const v = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value
      if (typeof v?.latitude === 'number') byQid.set(qid, { lat: v.latitude, lng: v.longitude })
    }
    await sleep(600)
  }
  return byQid
}

/* ---------------- 坐标与几何工具 ---------------- */

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
  let magic = 1 - GCJ_EE * Math.sin(radLat) * Math.sin(radLat)
  const sq = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sq)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sq) * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInFeature(pt, f) {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((r) => pointInRing(pt, r)))
}

/** 用省级边界 GeoJSON 推导景区所在地级市（feature 名，去掉尾部「市」） */
async function loadProvinceFeatures() {
  const out = new Map()
  for (const [, short, adcode] of PROVS) {
    const text = await readFile(resolve(ROOT, `public/geo/provinces/${adcode}.json`), 'utf-8')
    const geo = JSON.parse(text)
    out.set(short, geo.features)
  }
  return out
}

function cityOf(features, pt) {
  for (const f of features) {
    if (pointInFeature(pt, f)) {
      const name = f.properties?.name ?? ''
      return name.endsWith('市') && name.length > 2 ? name.slice(0, -1) : name
    }
  }
  return null
}

/** 边界压线条目的坐标微调（界河/界山景区坐标落在边界另一侧） */
const BUILTIN_COORD_FIXES = {
  // 珠峰坐标在中尼边界上，DataV 边界略有偏差
  珠穆朗瑪峰: { lat: 28.01 },
  // 天生桥一级水电站在黔桂界河南盘江上
  天生桥一级水电站: { lat: 24.99 },
  // 九宫山为湘鄂界山，Wikidata 坐标落在湖南侧
  九宫山: { lng: 114.66, lat: 29.42 },
  // 锦州笔架山为海岛，DataV 海岸线不含该岛，就近微调
  笔架山: { lng: 121.08, lat: 40.8 },
}

/** 不应作为景区收录的词条（山脉/区域类误入分类） */
const BUILTIN_SKIPS = new Set(['天山山脉'])

/* ---------------- 名称工具 ---------------- */

function cjkOnly(s) {
  return s.replace(/[^一-鿿]/g, '')
}

function normName(name) {
  // 去括号消歧义（如「大明山 (浙江省)」→「大明山」）
  let s = name.replace(/[（(][^）)]*[）)]/g, '')
  for (const suf of [
    '风景名胜区',
    '风景旅游区',
    '旅游度假区',
    '生态旅游区',
    '文化旅游区',
    '旅游区',
    '度假区',
    '风景区',
    '景区',
  ]) {
    if (s.endsWith(suf) && s.length - suf.length >= 2) {
      s = s.slice(0, -suf.length)
      break
    }
  }
  return cjkOnly(s)
}

/* ---------------- 主流程 ---------------- */

async function main() {
  console.log('1. 枚举各省维基 4A 分类 …')
  const wikiSpots = [] // { title, cleanName, province }
  for (const [full, short] of PROVS) {
    const titles = await categoryMembers(`Category:${full}国家4A级旅游景区`)
    for (const t of titles) {
      const cleanName = t.replace(/[（(][^）)]*[）)]/g, '').trim()
      wikiSpots.push({ title: t, cleanName, province: short })
    }
    console.log(`  ${short}: ${titles.length} 条`)
    await sleep(500)
  }
  console.log(`  合计 ${wikiSpots.length} 条词条`)

  console.log('\n2. 批量查询词条坐标（WGS84）…')
  const coords = await fetchCoordinates(wikiSpots.map((s) => s.title))
  console.log(`  有坐标词条: ${coords.size}/${wikiSpots.length}`)

  console.log('\n3. 加载省边界，转换坐标并推导地级市 …')
  const provinceFeatures = await loadProvinceFeatures()
  // 全国边界的省级 feature（用于坐标落点校验，剔除维基词条坐标错误的条目）
  const chinaGeo = JSON.parse(await readFile(resolve(ROOT, 'public/geo/china.json'), 'utf-8'))
  const provFeature = new Map(chinaGeo.features.map((f) => [f.properties?.name, f]))
  const PROV_FULL = Object.fromEntries(PROVS.map(([full, short]) => [short, full]))

  const makeSpot = (s, lng, lat, coordSource) => ({
    name: s.cleanName,
    /** 维基百科原始词条名（含消歧义），配图/简介抓取用 */
    wikiTitle: s.title,
    level: '4A',
    province: s.province,
    city: cityOf(provinceFeatures.get(s.province), [lng, lat]) ?? s.province,
    year: null,
    category: null,
    lng: Math.round(lng * 1000) / 1000,
    lat: Math.round(lat * 1000) / 1000,
    official: true,
    coordSource,
  })

  /** 应用内置修正 + 省份边界校验，通过返回 [lng, lat]（GCJ-02） */
  const validateCoord = (s, lng, lat, wgs) => {
    const fix = BUILTIN_COORD_FIXES[s.cleanName]
    if (fix?.lat !== undefined) lat = fix.lat
    if (fix?.lng !== undefined) lng = fix.lng
    const f = provFeature.get(PROV_FULL[s.province])
    const ok = (f && pointInFeature([lng, lat], f)) || (f && wgs && pointInFeature(wgs, f))
    return ok ? [lng, lat] : null
  }

  const out = []
  /** 词条坐标缺失/异常，等待 Wikidata 救援 */
  const missing = []
  for (const s of wikiSpots) {
    if (BUILTIN_SKIPS.has(s.cleanName)) continue
    const c = coords.get(s.title)
    if (!c) {
      missing.push({ ...s, wgs: null })
      continue
    }
    const [lng, lat] = wgs2gcj(c.lng, c.lat)
    const ok = validateCoord(s, lng, lat, [c.lng, c.lat])
    if (!ok) {
      missing.push({ ...s, wgs: [c.lng, c.lat] })
      continue
    }
    out.push(makeSpot(s, ok[0], ok[1], '维基百科分类 + 词条坐标（WGS84→GCJ-02）'))
  }
  console.log(`  词条坐标可用: ${out.length} 条；待 Wikidata 救援: ${missing.length} 条`)

  // 3b. Wikidata 坐标救援（词条无坐标或坐标错误时查 Wikidata P625）
  const qids = await fetchWikidataQids(missing.map((m) => m.title))
  const qidList = [...new Set(qids.values())]
  const wdCoords = qidList.length ? await fetchWikidataCoords(qidList) : new Map()
  let rescued = 0
  const stillMissing = []
  for (const m of missing) {
    const qid = qids.get(m.title)
    const c = qid ? wdCoords.get(qid) : null
    if (!c) {
      stillMissing.push(m)
      continue
    }
    const [lng, lat] = wgs2gcj(c.lng, c.lat)
    const ok = validateCoord(m, lng, lat, [c.lng, c.lat])
    if (ok) {
      out.push(makeSpot(m, ok[0], ok[1], '维基百科分类 + Wikidata 坐标（WGS84→GCJ-02）'))
      rescued++
    } else {
      stillMissing.push(m)
    }
  }
  console.log(`  Wikidata 救援: ${rescued} 条；仍无可用坐标: ${stillMissing.length} 条`)
  console.log(`  可定位合计: ${out.length} 条`)
  if (stillMissing.length <= 20) {
    for (const s of stillMissing) console.log(`    - ${s.province} ${s.cleanName}`)
  }

  console.log('\n4. 合并精选条目（字段优先）…')
  let merged = 0
  for (const cur of patches4A.spots) {
    const [lng, lat] = wgs2gcj(cur.lng, cur.lat)
    const gcj = { lng: Math.round(lng * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 }
    const hit = out.find(
      (s) => s.province === cur.province && normName(s.name) === normName(cur.name),
    )
    if (hit) {
      // 精选信息覆盖（简介/类别/年份/校准过的坐标）
      Object.assign(hit, {
        name: cur.name,
        year: cur.year,
        category: cur.category,
        desc: cur.desc,
        lng: gcj.lng,
        lat: gcj.lat,
        coordSource: cur.coordSource?.startsWith('wgs84')
          ? '人工核对精选（WGS84→GCJ-02）'
          : cur.coordSource,
      })
      merged++
    } else {
      out.push({
        name: cur.name,
        level: '4A',
        province: cur.province,
        city: cur.city,
        year: cur.year,
        category: cur.category,
        desc: cur.desc,
        lng: gcj.lng,
        lat: gcj.lat,
        official: true,
        coordSource: '人工核对精选（WGS84→GCJ-02）',
      })
    }
  }
  console.log(`  合并 ${merged} 条，精选独有补充 ${patches4A.spots.length - merged} 条`)

  // 同名消歧：跨省同名景区加省份前缀（parse 层按全局唯一名校验）
  const nameCount = new Map()
  for (const s of out) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1)
  for (const s of out) {
    if (nameCount.get(s.name) > 1 && !s.name.startsWith(s.province)) {
      s.name = s.province + s.name
    }
  }
  // 去重（同省内归一化重名）
  const seen = new Map()
  const deduped = []
  for (const s of out) {
    const key = `${s.province}|${normName(s.name)}`
    if (seen.has(key)) continue
    seen.set(key, true)
    deduped.push(s)
  }
  console.log(`  去重后: ${deduped.length} 条`)

  deduped.sort(
    (a, b) => a.province.localeCompare(b.province, 'zh') || a.name.localeCompare(b.name, 'zh'),
  )

  await mkdir(resolve(ROOT, 'public/data'), { recursive: true })
  await writeFile(resolve(ROOT, 'public/data/spots-4a.json'), JSON.stringify(deduped))
  const rich = deduped.filter((s) => s.desc).length
  console.log(`\n完成：public/data/spots-4a.json — ${deduped.length} 条（含简介 ${rich} 条）`)

  // 同步 meta.json 的 4A 计数
  const metaPath = resolve(ROOT, 'src/data/meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
  meta.spotCount4A = deduped.length
  meta.notes = meta.notes
    .map((n) =>
      typeof n === 'string' && (n.startsWith('4A') || n.includes('4A 评级年份')) ? null : n,
    )
    .filter(Boolean)
  meta.notes.push(
    `4A 全量 ${deduped.length} 条：来自维基百科 31 个省级行政区 4A 分类（4A 无国家统一名录），坐标取自词条/Wikidata 并经省份边界落点校验（Wikidata 救援 ${rescued} 条，${stillMissing.length} 条无可用坐标未收录），精选 103 条经对抗性核查并有简介`,
    '4A 评级年份多数未知（null），年份滑块对其不生效',
  )
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
  console.log('src/data/meta.json 4A 计数已更新')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
