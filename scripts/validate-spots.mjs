#!/usr/bin/env node
/**
 * 数据集质量校验（CI 质量门）：
 *   1. 结构：必填字段齐全、类型正确、等级只允许 5A/4A
 *   2. 省市：province 必须在 34 个省级行政区表内
 *   3. 坐标：经纬度范围合理（中国境内），且落在声称省份的边界内（GCJ 偏移容忍）
 *   4. 查重：同省内名称不重复
 *
 * 用法：npm run data:validate
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PROV = {
  北京: '北京市',
  天津: '天津市',
  河北: '河北省',
  山西: '山西省',
  内蒙古: '内蒙古自治区',
  辽宁: '辽宁省',
  吉林: '吉林省',
  黑龙江: '黑龙江省',
  上海: '上海市',
  江苏: '江苏省',
  浙江: '浙江省',
  安徽: '安徽省',
  福建: '福建省',
  江西: '江西省',
  山东: '山东省',
  河南: '河南省',
  湖北: '湖北省',
  湖南: '湖南省',
  广东: '广东省',
  广西: '广西壮族自治区',
  海南: '海南省',
  重庆: '重庆市',
  四川: '四川省',
  贵州: '贵州省',
  云南: '云南省',
  西藏: '西藏自治区',
  陕西: '陕西省',
  甘肃: '甘肃省',
  青海: '青海省',
  宁夏: '宁夏回族自治区',
  新疆: '新疆维吾尔自治区',
  台湾: '台湾省',
  香港: '香港特别行政区',
  澳门: '澳门特别行政区',
}

// 4A 批量条目 category/desc 允许为 null
const REQUIRED = ['name', 'level', 'province', 'city', 'year', 'lng', 'lat', 'official']

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

function pointInFeature(pt, feature) {
  const g = feature.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((r) => pointInRing(pt, r)))
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf-8'))
}

async function main() {
  const [spots5a, spots4a, china] = await Promise.all([
    readJson('src/data/spots.json'),
    readJson('public/data/spots-4a.json'),
    readJson('public/geo/china.json'),
  ])
  const spots = [...spots5a, ...spots4a]
  const features = new Map(china.features.map((f) => [f.properties?.name, f]))

  const problems = []
  const seen = new Map()
  for (const s of spots) {
    const tag = `[${s.level}] ${s.province} ${s.name}`
    for (const k of REQUIRED) {
      if (s[k] === undefined) problems.push(`${tag}: 缺少字段 ${k}`)
    }
    if (s.level !== '5A' && s.level !== '4A') problems.push(`${tag}: 非法等级 ${s.level}`)
    if (!PROV[s.province]) problems.push(`${tag}: 未知省份 ${s.province}`)
    if (typeof s.lng !== 'number' || typeof s.lat !== 'number') {
      problems.push(`${tag}: 坐标类型错误`)
      continue
    }
    if (s.lng < 70 || s.lng > 140 || s.lat < 5 || s.lat > 55) {
      problems.push(`${tag}: 坐标超出中国范围 (${s.lng},${s.lat})`)
    }
    if (s.year !== null && (s.year < 2000 || s.year > 2026)) {
      problems.push(`${tag}: 年份异常 ${s.year}`)
    }
    if (s.level === '5A' && !s.category) problems.push(`${tag}: 5A 缺少类别`)
    const key = `${s.province}|${s.name}`
    if (seen.has(key)) {
      problems.push(`${tag}: 与 [${seen.get(key)}] 同省重名`)
    } else {
      seen.set(key, s.level)
    }
    // 落点校验
    const f = features.get(PROV[s.province])
    if (f && !pointInFeature([s.lng, s.lat], f)) {
      problems.push(`${tag}: 坐标不在 ${s.province} 边界内 (${s.lng},${s.lat})`)
    }
  }

  const count5a = spots.filter((s) => s.level === '5A').length
  const count4a = spots.filter((s) => s.level === '4A').length
  console.log(`5A: ${count5a} 条，4A: ${count4a} 条，合计 ${spots.length} 条`)
  if (problems.length) {
    console.error(`\n发现 ${problems.length} 个问题：`)
    for (const p of problems.slice(0, 60)) console.error(`  ✗ ${p}`)
    if (problems.length > 60) console.error(`  … 等共 ${problems.length} 个`)
    process.exit(1)
  }
  console.log('校验通过 ✅')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
