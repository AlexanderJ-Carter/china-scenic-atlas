#!/usr/bin/env node
/**
 * 下载中国行政区划边界 GeoJSON 到 public/geo/（vendor 进仓库，运行时不依赖外部 CDN）。
 *
 * 数据来源：阿里云 DataV.GeoAtlas（GCJ-02 坐标系）
 *   全国:  https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
 *   省份:  https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
 *          台湾省无 _full 文件（无市级子区域），回退使用 {adcode}.json
 *
 * 用法：npm run data:geo
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATAV = 'https://geo.datav.aliyun.com/areas_v3/bound'
const GEO_DIR = resolve(ROOT, 'public/geo')
const PROVINCE_DIR = resolve(GEO_DIR, 'provinces')

const PROVINCES = [
  { short: '北京', full: '北京市', adcode: 110000 },
  { short: '天津', full: '天津市', adcode: 120000 },
  { short: '河北', full: '河北省', adcode: 130000 },
  { short: '山西', full: '山西省', adcode: 140000 },
  { short: '内蒙古', full: '内蒙古自治区', adcode: 150000 },
  { short: '辽宁', full: '辽宁省', adcode: 210000 },
  { short: '吉林', full: '吉林省', adcode: 220000 },
  { short: '黑龙江', full: '黑龙江省', adcode: 230000 },
  { short: '上海', full: '上海市', adcode: 310000 },
  { short: '江苏', full: '江苏省', adcode: 320000 },
  { short: '浙江', full: '浙江省', adcode: 330000 },
  { short: '安徽', full: '安徽省', adcode: 340000 },
  { short: '福建', full: '福建省', adcode: 350000 },
  { short: '江西', full: '江西省', adcode: 360000 },
  { short: '山东', full: '山东省', adcode: 370000 },
  { short: '河南', full: '河南省', adcode: 410000 },
  { short: '湖北', full: '湖北省', adcode: 420000 },
  { short: '湖南', full: '湖南省', adcode: 430000 },
  { short: '广东', full: '广东省', adcode: 440000 },
  { short: '广西', full: '广西壮族自治区', adcode: 450000 },
  { short: '海南', full: '海南省', adcode: 460000 },
  { short: '重庆', full: '重庆市', adcode: 500000 },
  { short: '四川', full: '四川省', adcode: 510000 },
  { short: '贵州', full: '贵州省', adcode: 520000 },
  { short: '云南', full: '云南省', adcode: 530000 },
  { short: '西藏', full: '西藏自治区', adcode: 540000 },
  { short: '陕西', full: '陕西省', adcode: 610000 },
  { short: '甘肃', full: '甘肃省', adcode: 620000 },
  { short: '青海', full: '青海省', adcode: 630000 },
  { short: '宁夏', full: '宁夏回族自治区', adcode: 640000 },
  { short: '新疆', full: '新疆维吾尔自治区', adcode: 650000 },
  { short: '台湾', full: '台湾省', adcode: 710000 },
  { short: '香港', full: '香港特别行政区', adcode: 810000 },
  { short: '澳门', full: '澳门特别行政区', adcode: 820000 },
]

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'china-scenic-map/fetch-geojson (data vendoring script)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function main() {
  await mkdir(PROVINCE_DIR, { recursive: true })

  // 1. 全国边界（含 34 个省级行政区 + 十段线/南海诸岛）
  console.log('下载全国边界 …')
  const china = await fetchJson(`${DATAV}/100000_full.json`)
  await writeFile(resolve(GEO_DIR, 'china.json'), JSON.stringify(china))
  console.log(
    `  ✓ china.json — ${(JSON.stringify(china).length / 1024).toFixed(0)} KB, ${china.features.length} features`,
  )

  // 校验省份表与全国文件 feature 名对齐
  const featureNames = new Map(china.features.map((f) => [f.properties?.name, f.properties]))
  const missing = PROVINCES.filter((p) => !featureNames.has(p.full))
  if (missing.length) {
    console.warn(`  ⚠ 全国边界中缺少: ${missing.map((p) => p.full).join(', ')}`)
  }

  // 2. 省级边界（含市级行政区，用于省份下钻）
  let total = 0
  for (const p of PROVINCES) {
    let geo
    const fullUrl = `${DATAV}/${p.adcode}_full.json`
    try {
      geo = await fetchJson(fullUrl)
    } catch {
      // 台湾等无子区域的行政区回退到无 _full 版本
      geo = await fetchJson(`${DATAV}/${p.adcode}.json`)
      console.log(`  ~ ${p.full}: 无 _full 文件，使用单区边界`)
    }
    const str = JSON.stringify(geo)
    total += str.length
    await writeFile(resolve(PROVINCE_DIR, `${p.adcode}.json`), str)
    console.log(
      `  ✓ ${p.full} (${p.adcode}) — ${(str.length / 1024).toFixed(0)} KB, ${geo.features.length} features`,
    )
  }

  console.log(`\n完成：35 个边界文件，共 ${(total / 1024 / 1024).toFixed(2)} MB（省级合计）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
