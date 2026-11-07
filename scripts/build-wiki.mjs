#!/usr/bin/env node
/**
 * 构建景区维基数据本地库 public/data/wiki.json（简介 + 代表配图 URL）。
 *
 * 数据源：中文维基百科（批量 Action API，50 词条/请求，重定向自动跟随）
 *   1. 词条名解析管线（多轮收敛）：全名 → 去城市前缀 → 多轮去通用后缀 →
 *      去括号 → 人工 alias 兜底；消歧义页（pageprops.disambiguation）跳过
 *   2. 配图分级：pageimages 主图 →（logo/旗帜/SVG 等劣质图）→ 词条图片列表
 *      过滤选照片（imageinfo 400px）→（仍无）→ Wikidata P18（Commons 400px）
 *   3. 简介：prop=extracts（exintro 纯文本，截断 200 字）
 *
 * 速率：~500ms/请求 + 429 退避（--slow 1200ms，限流紧张时使用）。
 * 增量模式：--only-missing 跳过已有结果的条目（限流下分多次跑，逐步收敛）。
 * 用法：node scripts/build-wiki.mjs [--limit 20] [--only-missing] [--slow]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://zh.wikipedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const UA = 'china-scenic-map/1.0 (open-source scenic map; dataset build script)'
const LIMIT = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : Infinity
const ONLY_MISSING = process.argv.includes('--only-missing')
const SLOW = process.argv.includes('--slow')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params, endpoint = API) {
  let lastErr = null
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${endpoint}?${new URLSearchParams(params)}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      })
      if (res.status === 429) {
        lastErr = new Error('429 rate limited')
        await sleep(8000 * (attempt + 1))
        continue
      }
      // 限流时 wiki 会直接返回纯文本
      const text = await res.text()
      if (text.startsWith('You are making')) {
        lastErr = new Error('429 rate limited (text)')
        await sleep(10000 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return JSON.parse(text)
    } catch (e) {
      lastErr = e
      if (attempt === 5) throw e
      await sleep(3000 * (attempt + 1))
    }
  }
  throw lastErr ?? new Error('api failed')
}

/* ---------------- 配图质量判定 ---------------- */

const BAD_IMAGE_KEYWORDS =
  /(logo|icon|flag|emblem|coat[_ ]?of[_ ]?arms|seal|map[_ ]of|locator|distribution|位置图|分布图|旗帜|徽章|封面)/i
const SVG_RASTER_RE = /\.svg(\.png|\.gif)?(\?|$)/i

function isBadThumb(url) {
  return !url || SVG_RASTER_RE.test(url) || BAD_IMAGE_KEYWORDS.test(url)
}

const BAD_FILE_RE =
  /(logo|icon|flag|emblem|coat_of_arms|seal|locator|distribution|commons|wiki|blank|red_pencil|question|ambox|edit|symbol|车站|机场|铁路|高速公路|国道|省道|coordinate|oldd?map|banner|柱状图|_map_|_Map_|聖火|火炬)/i

/* ---------------- 词条名候选管线 ---------------- */

const SUFFIXES = [
  '生态文化旅游区',
  '生态旅游示范区',
  '文化生态旅游区',
  '文化旅游区',
  '旅游度假区',
  '风景名胜区',
  '风景旅游区',
  '旅游风景区',
  '度假区',
  '风景区',
  '旅游区',
  '大景区',
  '景区',
  '博物院',
  '博物馆',
  '公园',
  '旅游',
  '文化',
  '古镇',
  '古城',
]

/** 前置修饰词剥除（「跨国」「世界文化遗产」等维基词条不带的定语） */
const MODIFIERS = [
  '跨国',
  '世界文化遗产',
  '世界自然遗产',
  '国家森林公园',
  '国家地质公园',
  '国家湿地公园',
  '海上丝路',
]

function stripModifiers(s) {
  let changed = true
  while (changed) {
    changed = false
    for (const mod of MODIFIERS) {
      if (s.includes(mod)) {
        s = s.replace(mod, '')
        changed = true
      }
    }
  }
  return s
}

/** 多轮剥通用后缀 */
function stripSuffixes(s) {
  let changed = true
  while (changed) {
    changed = false
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= 2) {
        s = s.slice(0, -suf.length)
        changed = true
        break
      }
    }
  }
  return s
}

const ALIASES = {
  '黄山皖南古村落（西递·宏村）': '皖南古村落',
  北京大运河文化旅游景区: '大运河',
  // 搜索实测确认的正确词条名（词条名与景区名差异大）
  阜阳八里河景区: '八里河风景区',
  云阳龙缸景区: '龙缸',
  黔江濯水景区: '濯水镇 (重庆市)',
  '万盛黑山谷-龙鳞石海风景区': '黑山谷',
  崇左德天跨国瀑布景区: '德天瀑布',
  陇南官鹅沟景区: '官鹅沟国家森林公园',
  宣城绩溪龙川景区: '龙川村',
  三明泰宁风景旅游区: '大金湖',
  合肥三河古镇景区: '三河镇 (肥西县)',
  临夏炳灵寺世界文化遗产旅游区: '炳灵寺石窟',
  深圳观澜湖休闲旅游区: '观澜湖',
  佛山长鹿旅游休博园: '长鹿农庄',
  莆田湄洲岛妈祖文化旅游区: '湄洲岛',
  涪陵武陵山大裂谷景区: '武陵山大裂谷',
  厦门园林植物园景区: '厦门园林植物园',
  梅州雁南飞茶田景区: '雁南飞茶田',
  清远连州地下河景区: '连州地下河',
  阳江海陵岛大角湾海上丝路旅游区: '海陵岛',
  '唐山南湖·开滦旅游景区': '唐山南湖',
  '呼伦贝尔大草原·莫尔格勒河景区': '莫日格勒河',
  石家庄西柏坡景区: '西柏坡',
  哈尔滨太阳岛景区: '太阳岛 (哈尔滨)',
  黑河五大连池景区: '五大连池世界地质公园',
  齐齐哈尔扎龙生态旅游区: '黑龙江扎龙国家级自然保护区',
  中卫沙坡头旅游景区: '中卫市沙坡头旅游景区',
  石嘴山沙湖旅游景区: '沙湖 (石嘴山)',
  嘉兴西塘古镇旅游景区: '西塘镇 (嘉善县)',
  神农架生态旅游区: '神农架林区',
  阿坝黄龙景区: '黄龙风景名胜区',
  济南天下第一泉景区: '趵突泉',
  南京钟山风景名胜区中山陵园风景区: '紫金山',
  '南京钟山风景名胜区-中山陵园风景区': '紫金山',
  常州环球恐龙城休闲旅游区: '中华恐龙园',
  承德避暑山庄及周围寺庙景区: '承德避暑山庄及其周围寺庙',
  和静巴音布鲁克景区: '巴音布鲁克草原',
  敦煌鸣沙山月牙泉景区: '月牙泉',
}

/** 候选名序列（由精确到宽泛） */
function titleCandidates(spot) {
  const cands = []
  if (spot.wikiTitle) cands.push(spot.wikiTitle)
  const name = spot.name
  if (ALIASES[name]) cands.push(ALIASES[name])
  cands.push(name)
  let base = name
  if (spot.city && base.startsWith(spot.city) && base.length > spot.city.length + 1) {
    base = base.slice(spot.city.length)
    cands.push(base)
  }
  const noBracket = name.replace(/[（(][^）)]*[）)]/g, '')
  if (noBracket !== name && noBracket.length >= 2) cands.push(noBracket)
  const stripped = stripSuffixes(noBracket)
  if (stripped !== noBracket && stripped.length >= 2) cands.push(stripped)
  // 去括号 + 去后缀的极简核心名
  let core = noBracket
  if (spot.city && core.startsWith(spot.city) && core.length > spot.city.length + 1) {
    core = core.slice(spot.city.length)
  }
  const coreStripped = stripSuffixes(core)
  if (coreStripped !== core && coreStripped.length >= 2) cands.push(coreStripped)
  // 去定语 + 去后缀（德天跨国瀑布 → 德天瀑布）
  const demod = stripSuffixes(stripModifiers(coreStripped))
  if (demod !== coreStripped && demod.length >= 2) cands.push(demod)
  // 联合体拆分（「A及B」「A-B」「A·B」→ A）：多数联合评定词条只覆盖主体部分
  for (const seg of [demod, coreStripped, stripped]) {
    const m = seg.match(/^([^及\-—·]{2,})[及\-—·]/)
    if (m) {
      const head = stripSuffixes(m[1])
      if (head.length >= 2) cands.push(head)
    }
  }
  return [...new Set(cands)]
}

/** 搜索兜底：核心词搜索，返回前几个可信结果（跳过消歧义词页） */
async function searchFallback(query) {
  try {
    const data = await api({
      action: 'query',
      list: 'search',
      format: 'json',
      srsearch: query,
      srlimit: '6',
      srnamespace: '0',
    })
    const ok = []
    for (const r of data.query?.search ?? []) {
      if (/消歧义/.test(r.title)) continue
      // 结果标题须与搜索词有 ≥2 字公共前缀（防止搜到无关词条）
      let common = 0
      while (common < Math.min(r.title.length, query.length) && r.title[common] === query[common])
        common++
      if (common >= 2) ok.push(r.title)
      if (ok.length >= 2) break
    }
    return ok
  } catch {
    /* 忽略（限流等） */
  }
  return []
}

/* ---------------- 批量查询 ---------------- */

/**
 * 批量解析词条：返回 title → { page, thumb, extract, qid, canonical }
 * 消歧义页/缺失页返回 undefined。
 */
async function batchResolve(titles) {
  const result = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const data = await api({
      action: 'query',
      format: 'json',
      redirects: '1',
      prop: 'pageimages|pageprops|extracts',
      piprop: 'thumbnail',
      pithumbsize: '400',
      ppprop: 'disambiguation|wikibase_item',
      exintro: '1',
      explaintext: '1',
      exlimit: '20',
      titles: batch.join('|'),
    })
    // 重定向映射（from → to，可能多级，API 已展平为最终目标）
    const redirectMap = new Map()
    for (const r of data.query?.redirects ?? []) redirectMap.set(r.from, r.to)
    for (const n of data.query?.normalized ?? []) redirectMap.set(n.from, n.to)
    const pages = new Map()
    for (const page of Object.values(data.query?.pages ?? {})) {
      pages.set(page.title, page)
    }
    const resolveTitle = (t) => {
      let cur = t
      for (let hop = 0; hop < 4; hop++) {
        const next = redirectMap.get(cur)
        if (!next) return cur
        cur = next
      }
      return cur
    }
    for (const t of batch) {
      const final = resolveTitle(t)
      const page = pages.get(final)
      if (!page || page.missing !== undefined) continue
      if (page.pageprops?.disambiguation !== undefined) continue // 消歧义页跳过
      result.set(t, {
        canonical: final,
        thumb: page.thumbnail?.source,
        extract: typeof page.extract === 'string' && page.extract ? page.extract : undefined,
        qid: page.pageprops?.wikibase_item,
      })
    }
    await sleep(500)
  }
  return result
}

/** 批量查词条页面图片列表，为每个词条选出第一张「照片」文件名 */
async function batchPickPhotos(canonicalTitles) {
  const chosen = new Map() // canonical title → File:xxx
  for (let i = 0; i < canonicalTitles.length; i += 50) {
    const batch = canonicalTitles.slice(i, i + 50)
    const data = await api({
      action: 'query',
      format: 'json',
      redirects: '1',
      prop: 'images',
      imlimit: '60',
      titles: batch.join('|'),
    })
    const pages = new Map()
    for (const page of Object.values(data.query?.pages ?? {})) pages.set(page.title, page)
    for (const t of batch) {
      const page = pages.get(t)
      if (!page) continue
      const file = (page.images ?? [])
        .map((im) => im.title)
        .find((f) => /\.(jpe?g|png|webp)$/i.test(f) && !BAD_FILE_RE.test(f) && !isBadThumb(f))
      if (file) chosen.set(t, file)
    }
    await sleep(500)
  }
  return chosen
}

/** 批量取文件缩略图 URL（Commons/zh wiki 文件页） */
async function batchFileThumbs(files, endpoint = API) {
  const urls = new Map()
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50)
    const data = await api(
      {
        action: 'query',
        format: 'json',
        prop: 'imageinfo',
        iiprop: 'url',
        iiurlwidth: '400',
        titles: batch.join('|'),
      },
      endpoint,
    )
    for (const page of Object.values(data.query?.pages ?? {})) {
      const url = page.imageinfo?.[0]?.thumburl
      if (url) urls.set(page.title, url)
    }
    await sleep(500)
  }
  return urls
}

/** 批量查 Wikidata P18 文件名 */
async function batchP18(qids) {
  const byQid = new Map()
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50)
    const data = await api(
      { action: 'wbgetentities', ids: batch.join('|'), props: 'claims', format: 'json' },
      WIKIDATA_API,
    )
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      if (typeof p18 === 'string' && p18) byQid.set(qid, p18)
    }
    await sleep(500)
  }
  return byQid
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const spots5a = JSON.parse(await readFile(resolve(ROOT, 'src/data/spots.json'), 'utf-8'))
  const spots4a = JSON.parse(await readFile(resolve(ROOT, 'public/data/spots-4a.json'), 'utf-8'))
  const spots = [...spots5a, ...spots4a].slice(0, LIMIT)
  console.log(`景区 ${spots.length} 条（5A ${spots5a.length} + 4A ${spots4a.length}）`)

  // Phase 1-2: 候选索引轮转解析（每轮把各景区的下一个候选名批量查询）
  const resolved = new Map() // spotName → resolve 结果
  const candsCache = new Map(spots.map((s) => [s.name, titleCandidates(s)]))
  let pending = spots.map((s) => ({ name: s.name, idx: 0 }))
  // 增量模式：预载已有结果，只处理空缺条目（限流下分多次跑收敛）
  if (ONLY_MISSING) {
    try {
      const existing = JSON.parse(await readFile(resolve(ROOT, 'public/data/wiki.json'), 'utf-8'))
      for (const s of spots) {
        const v = existing[s.name]
        if (v && (v.thumb || v.extract)) {
          resolved.set(s.name, {
            canonical: decodeURIComponent((v.url ?? '').split('/wiki/')[1] ?? s.name).replace(
              /_/g,
              ' ',
            ),
            thumb: v.thumb,
            extract: v.extract,
            qid: undefined,
          })
        }
      }
      pending = spots.filter((s) => !resolved.has(s.name)).map((s) => ({ name: s.name, idx: 0 }))
      console.log(`  增量模式：已有 ${resolved.size}，待补 ${pending.length}`)
    } catch {
      /* 无现有文件 */
    }
  }
  for (let round = 0; round < 10; round++) {
    const titles = []
    const itemOfTitle = new Map()
    for (const p of pending) {
      const cands = candsCache.get(p.name)
      while (p.idx < cands.length && !cands[p.idx]) p.idx++
      if (p.idx >= cands.length) continue
      const cand = cands[p.idx]
      titles.push(cand)
      itemOfTitle.set(cand, p)
    }
    if (!titles.length) break
    console.log(`  解析第 ${round + 1} 轮：${titles.length} 个候选 …`)
    const batch = await batchResolve(titles)
    for (const t of titles) {
      const p = itemOfTitle.get(t)
      if (batch.has(t)) resolved.set(p.name, batch.get(t))
      else p.idx++ // 未命中 → 下轮尝试下一个候选
    }
    pending = pending.filter((p) => !resolved.has(p.name))
    console.log(`    命中累计 ${resolved.size}，待解析 ${pending.length}`)
  }
  const unresolved = spots.filter((s) => !resolved.has(s.name))
  console.log(`词条命中 ${resolved.size}/${spots.length}（未命中 ${unresolved.length}）`)

  // Phase 2b: 搜索兜底（核心词搜索，防错配约束，逐条慢速）
  if (unresolved.length) {
    console.log(`\n搜索兜底：${unresolved.length} 条`)
    const foundTitles = []
    const spotOfTitle = new Map()
    for (const s of unresolved) {
      const cands = candsCache.get(s.name)
      const query = cands[cands.length - 1] ?? s.name
      const hits = await searchFallback(query)
      for (const t of hits) {
        foundTitles.push(t)
        spotOfTitle.set(t, s)
        break // 取第一个可信结果
      }
      await sleep(SLOW ? 1200 : 700)
    }
    if (foundTitles.length) {
      const batch = await batchResolve(foundTitles)
      let found = 0
      for (const t of foundTitles) {
        const s = spotOfTitle.get(t)
        if (batch.has(t)) {
          resolved.set(s.name, batch.get(t))
          found++
        }
      }
      console.log(`  搜索命中 ${found} 条，最终未命中 ${spots.length - resolved.size} 条`)
    }
  }

  // Phase 3: 无图/劣质图 → 词条图片列表选照片
  const needPhoto = [...resolved.entries()].filter(([, r]) => isBadThumb(r.thumb))
  console.log(`\n配图补选：${needPhoto.length} 条主图缺失或劣质`)
  const canonicals = needPhoto.map(([, r]) => r.canonical)
  const chosenFiles = canonicals.length ? await batchPickPhotos(canonicals) : new Map()
  const fileList = [...chosenFiles.values()]
  const fileUrls = fileList.length ? await batchFileThumbs(fileList) : new Map()
  let photoFixed = 0
  for (const [name, r] of needPhoto) {
    const f = chosenFiles.get(r.canonical)
    const url = f ? fileUrls.get(f) : null
    if (url) {
      r.thumb = url
      photoFixed++
    } else {
      r.thumb = undefined
    }
  }
  console.log(`  页内照片补选成功 ${photoFixed} 条`)

  // Phase 4: 仍无图 → Wikidata P18（Commons）
  const needP18 = [...resolved.entries()].filter(([, r]) => !r.thumb && r.qid)
  console.log(`\nP18 兜底：${needP18.length} 条`)
  if (needP18.length) {
    const p18Files = await batchP18([...new Set(needP18.map(([, r]) => r.qid))])
    const commonsTitles = [...new Set([...p18Files.values()])].map((f) => `File:${f}`)
    const commonsUrls = commonsTitles.length
      ? await batchFileThumbs(commonsTitles, COMMONS_API)
      : new Map()
    let p18Fixed = 0
    for (const [name, r] of needP18) {
      const f = p18Files.get(r.qid)
      const url = f ? commonsUrls.get(`File:${f}`) : null
      if (url) {
        r.thumb = url
        p18Fixed++
      }
    }
    console.log(`  P18 补图成功 ${p18Fixed} 条`)
  }

  // Phase 5: 输出
  const out = {}
  let withPhoto = 0
  let withExtract = 0
  for (const s of spots) {
    const r = resolved.get(s.name)
    if (!r) {
      out[s.name] = {}
      continue
    }
    const trimmed =
      r.extract && r.extract.length > 200
        ? r.extract.slice(0, 200).replace(/[。！？；，][^。！？；，]*$/, '') + '…'
        : r.extract
    if (r.thumb) withPhoto++
    if (trimmed) withExtract++
    out[s.name] = {
      ...(r.thumb ? { thumb: r.thumb } : {}),
      ...(trimmed && !/可以指|可能指|下列意思/.test(trimmed) ? { extract: trimmed } : {}),
      url: `${'https://zh.wikipedia.org/wiki/'}${encodeURIComponent(r.canonical)}`,
    }
  }
  await mkdir(resolve(ROOT, 'public/data'), { recursive: true })
  await writeFile(resolve(ROOT, 'public/data/wiki.json'), JSON.stringify(out))
  const size = (JSON.stringify(out).length / 1024).toFixed(0)
  console.log(
    `\n完成：public/data/wiki.json（${size} KB）— 词条 ${resolved.size}/${spots.length}，配图 ${withPhoto}，简介 ${withExtract}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
