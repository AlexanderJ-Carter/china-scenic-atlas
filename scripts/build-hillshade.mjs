#!/usr/bin/env node
/**
 * 生成中国地形晕渲图 public/data/hillshade.png + hillshade-meta.json。
 *
 * 流程：
 *   1. 下载 AWS Terrain Tiles（terrarium 格式，公开免密钥）z=7 覆盖中国范围
 *   2. 解码高程（elevation = R*256 + G + B/256 - 32768）
 *   3. 反算 Web Mercator → 经纬度 → Lambert 等角圆锥（与前端 projection.ts 同参数）
 *   4. 输出 Lambert 平面上的高程栅格 → 晕渲（光照 NW315°/45°）+ 分层设色
 *      （低地绿 → 高山棕，海洋透明）
 *   5. PNG + 元数据（Lambert bbox），前端经 convertToPixel 逐像素对齐
 *
 * 体积约 1-2MB（1600px 宽），vendor 进仓库，运行时零网络。
 * 用法：node scripts/build-hillshade.mjs
 */
import { PNG } from 'pngjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TILE = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const Z = 7
const UA = 'china-scenic-map/1.0 (open-source scenic map; hillshade build script)'

/* ---------------- Lambert 等角圆锥（与 src/lib/projection.ts 完全一致） ---------------- */

const D = Math.PI / 180
const PHI1 = 25 * D
const PHI2 = 47 * D
const PHI0 = 36 * D
const LAMBDA0 = 105 * D
const N =
  Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2))
const F = (Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), N)) / N
const RHO0 = F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), N)

const project = (lng, lat) => {
  const p = lat * D
  const rho = F / Math.pow(Math.tan(Math.PI / 4 + p / 2), N)
  const th = N * (lng * D - LAMBDA0)
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)]
}

/* ---------------- Web Mercator 工具 ---------------- */

const lngToWorldX = (lng) => lng / 360 + 0.5
const latToWorldY = (lat) => {
  const s = Math.sin(lat * D)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}
// z 级单 tile 覆盖的世界坐标宽度
const TILE_SIZE = 1 / (1 << Z)

/* ---------------- 高程栅格（拼接 z=7 tiles） ---------------- */

const GEO_BBOX = { w: 73.0, e: 135.5, s: 15.0, n: 54.0 } // 含南海/海南

async function fetchTile(x, y) {
  // 磁盘缓存（重跑时不再下载）
  const cacheFile = resolve(ROOT, `.data-cache/tiles/${Z}/${x}_${y}.png`)
  try {
    const buf = await readFile(cacheFile)
    return PNG.sync.read(buf)
  } catch {
    /* 无缓存 */
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(TILE(Z, x, y), {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(dirname(cacheFile), { recursive: true })
      await writeFile(cacheFile, buf)
      return PNG.sync.read(buf)
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)))
    }
  }
  return null
}

/* ---------------- 国界裁剪掩膜（扫描线多边形填充） ---------------- */

/**
 * 用 china.json 各省多边形（投影到 Lambert 平面）生成境内掩膜：
 * 每条水平扫描线上，收集所有多边形边与该线的交点，排序配对填充。
 * 邻国/海洋区域透明——地形严格贴合国界，不再「大一圈」。
 */
function buildChinaMask(bx, outW, outH) {
  const china = JSON.parse(readFileSync(resolve(ROOT, 'public/geo/china.json'), 'utf-8'))
  // 收集所有边（投影平面）。顶点归属用半开区间 [min, max)：
  // 恰好穿过多边形顶点时只被其中一条边计数，保持交点数的偶性。
  const edges = []
  for (const f of china.features) {
    const polys =
      f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : (f.geometry?.coordinates ?? [])
    for (const poly of polys) {
      for (const ring of poly) {
        let prev = null
        for (const c of ring) {
          const pt = project(c[0], c[1])
          if (prev) {
            const [x1, y1] = prev
            const [x2, y2] = pt
            if (y1 !== y2) {
              edges.push({ ymin: Math.min(y1, y2), ymax: Math.max(y1, y2), x1, y1, x2, y2 })
            }
          }
          prev = pt
        }
      }
    }
  }
  console.log(`  国界裁剪：${edges.length} 条边`)
  // 每行扫描
  const mask = new Uint8Array(outW * outH)
  let oddRows = 0
  for (let oy = 0; oy < outH; oy++) {
    const y = bx.y1 - (oy / (outH - 1)) * (bx.y1 - bx.y0)
    const xs = []
    for (const e of edges) {
      if (y >= e.ymin && y < e.ymax) {
        const t = (y - e.y1) / (e.y2 - e.y1)
        xs.push(e.x1 + t * (e.x2 - e.x1))
      }
    }
    xs.sort((a, b) => a - b)
    if (xs.length % 2 !== 0) {
      oddRows++
      continue // 奇数交点（数值噪声），整行保守跳过
    }
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = ((xs[k] - bx.x0) / (bx.x1 - bx.x0)) * (outW - 1)
      const xEnd = ((xs[k + 1] - bx.x0) / (bx.x1 - bx.x0)) * (outW - 1)
      const i0 = Math.max(0, Math.floor(xStart))
      const i1 = Math.min(outW - 1, Math.ceil(xEnd))
      for (let i = i0; i <= i1; i++) mask[oy * outW + i] = 1
    }
  }
  if (oddRows) console.warn(`  ⚠ ${oddRows} 行交点数为奇数（跳过）`)
  let inCount = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) inCount++
  console.log(`  掩膜境内像素 ${((inCount / mask.length) * 100).toFixed(1)}%`)
  return mask
}

async function main() {
  // 输出 Lambert bbox（含边距）
  const corners = [
    project(GEO_BBOX.w, GEO_BBOX.n),
    project(GEO_BBOX.e, GEO_BBOX.n),
    project(GEO_BBOX.w, GEO_BBOX.s),
    project(GEO_BBOX.e, GEO_BBOX.s),
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  // 极小边距（防边界锯齿缝），大边距会让地形图「大一圈」
  const MARGIN = 0.002
  const bx = {
    x0: Math.min(...xs) - MARGIN,
    x1: Math.max(...xs) + MARGIN,
    y0: Math.min(...ys) - MARGIN,
    y1: Math.max(...ys) + MARGIN,
  }
  const OUT_W = 1500
  const OUT_H = Math.round((OUT_W * (bx.y1 - bx.y0)) / (bx.x1 - bx.x0))
  console.log(
    `输出 ${OUT_W}x${OUT_H}px，Lambert bbox x[${bx.x0.toFixed(3)}, ${bx.x1.toFixed(3)}] y[${bx.y0.toFixed(3)}, ${bx.y1.toFixed(3)}]`,
  )

  // Lambert (x,y) → 经纬度（用于反查高程）
  const unproject = (x, y) => {
    const rho = Math.sign(N) * Math.hypot(x, RHO0 - y)
    const th = Math.atan2(x, RHO0 - y)
    const lat = (2 * Math.atan(Math.pow(F / rho, 1 / N)) - Math.PI / 2) / D
    const lng = (LAMBDA0 + th / N) / D
    return [lng, lat]
  }

  // 拼接高程世界（z=7）
  const wx0 = Math.floor(lngToWorldX(GEO_BBOX.w) / TILE_SIZE)
  const wx1 = Math.floor(lngToWorldX(GEO_BBOX.e) / TILE_SIZE)
  const wy0 = Math.floor(latToWorldY(GEO_BBOX.n) / TILE_SIZE)
  const wy1 = Math.floor(latToWorldY(GEO_BBOX.s) / TILE_SIZE)
  const NX = wx1 - wx0 + 1
  const NY = wy1 - wy0 + 1
  console.log(`下载 tiles z${Z}: x[${wx0}..${wx1}] y[${wy0}..${wy1}] 共 ${NX * NY} 张 …`)

  const grid = new Float32Array(NX * 256 * NY * 256) // 高程世界（米）
  grid.fill(NaN)
  let loaded = 0
  for (let ty = wy0; ty <= wy1; ty++) {
    for (let tx = wx0; tx <= wx1; tx++) {
      const png = await fetchTile(tx, ty)
      if (!png) continue
      const gx0 = (tx - wx0) * 256
      const gy0 = (ty - wy0) * 256
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const idx = (gy0 + py) * NX * 256 + gx0 + px
          const r = png.data[(py * 256 + px) * 4]
          const g = png.data[(py * 256 + px) * 4 + 1]
          const b = png.data[(py * 256 + px) * 4 + 2]
          grid[idx] = r * 256 + g + b / 256 - 32768
        }
      }
      loaded++
      if (loaded % 50 === 0) console.log(`  已加载 ${loaded} tiles`)
    }
  }
  console.log(`  完成 ${loaded}/${NX * NY} tiles`)

  // 高程采样：世界坐标 → 双线性
  const sampleElev = (wx, wy) => {
    const fx = (wx / TILE_SIZE - wx0) * 256 - 0.5
    const fy = (wy / TILE_SIZE - wy0) * 256 - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    if (x0 < 0 || y0 < 0 || x0 + 1 >= NX * 256 || y0 + 1 >= NY * 256) return NaN
    const dx = fx - x0
    const dy = fy - y0
    const W = NX * 256
    const e00 = grid[y0 * W + x0]
    const e10 = grid[y0 * W + x0 + 1]
    const e01 = grid[(y0 + 1) * W + x0]
    const e11 = grid[(y0 + 1) * W + x0 + 1]
    if (Number.isNaN(e00) || Number.isNaN(e10) || Number.isNaN(e01) || Number.isNaN(e11)) return NaN
    return e00 * (1 - dx) * (1 - dy) + e10 * dx * (1 - dy) + e01 * (1 - dx) * dy + e11 * dx * dy
  }

  // 生成输出高程 + 晕渲
  const elevOut = new Float32Array(OUT_W * OUT_H)
  for (let oy = 0; oy < OUT_H; oy++) {
    const y = bx.y1 - (oy / (OUT_H - 1)) * (bx.y1 - bx.y0)
    for (let ox = 0; ox < OUT_W; ox++) {
      const x = bx.x0 + (ox / (OUT_W - 1)) * (bx.x1 - bx.x0)
      const [lng, lat] = unproject(x, y)
      elevOut[oy * OUT_W + ox] = sampleElev(lngToWorldX(lng), latToWorldY(lat))
    }
  }
  console.log('高程重采样完成，计算国界掩膜 …')
  const mask = buildChinaMask(bx, OUT_W, OUT_H)

  // 晕渲：光照方位 NW(315°)，高度 45°
  const cellW = ((bx.x1 - bx.x0) / OUT_W) * 111000 // 近似米/像素
  const png = new PNG({ width: OUT_W, height: OUT_H })
  let landPx = 0
  for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
      const i = y * OUT_W + x
      const o = (y * OUT_W + x) * 4
      // 境外/掩膜外/海洋一律透明——地形严格贴合国界
      if (!mask[i]) {
        png.data[o + 3] = 0
        continue
      }
      const e = elevOut[i]
      if (Number.isNaN(e) || e <= 0) {
        png.data[o + 3] = 0 // 海洋/无数据透明
        continue
      }
      landPx++
      const eL = elevOut[i - 1] ?? e
      const eR = elevOut[i + 1] ?? e
      const eU = elevOut[i - OUT_W] ?? e
      const eD = elevOut[i + OUT_W] ?? e
      // 法向量（z 向上）
      const dzdx = (eR - eL) / (2 * cellW) || 0
      const dzdy = (eD - eU) / (2 * cellW) || 0
      // 漫反射（光源 NW315°：光向量 x=-cos45, y=+cos45（北为 y 负向上 → 光来自北西），z=sin45
      const lx = -Math.SQRT1_2
      const ly = -Math.SQRT1_2
      const lz = Math.SQRT1_2
      const nx = -dzdx
      const ny = dzdy
      const nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      let shade = (nx * lx + ny * ly + nz * lz) / len
      shade = Math.max(0, shade)

      // 分层设色（低地绿 → 丘陵黄绿 → 山地棕 → 高山灰白）与晕渲相乘
      const [r, g, b] = hypsometric(e)
      const s = 0.55 + shade * 0.75 // 0.55~1.3
      png.data[o] = Math.min(255, Math.round(r * s))
      png.data[o + 1] = Math.min(255, Math.round(g * s))
      png.data[o + 2] = Math.min(255, Math.round(b * s))
      png.data[o + 3] = 255
    }
  }
  console.log(`陆地像素 ${((landPx / (OUT_W * OUT_H)) * 100).toFixed(1)}%`)

  await mkdir(resolve(ROOT, 'public/data'), { recursive: true })
  const buf = PNG.sync.write(png, { deflateLevel: 9 })
  await writeFile(resolve(ROOT, 'public/data/hillshade.png'), buf)
  await writeFile(
    resolve(ROOT, 'public/data/hillshade-meta.json'),
    JSON.stringify({ ...bx, width: OUT_W, height: OUT_H }),
  )
  console.log(
    `完成：public/data/hillshade.png（${(buf.length / 1024 / 1024).toFixed(2)} MB）+ hillshade-meta.json`,
  )
}

/** 分层设色 */
function hypsometric(e) {
  if (e < 200) return [198, 219, 174] // 平原 浅绿
  if (e < 500) return [186, 208, 156]
  if (e < 1000) return [206, 208, 148] // 丘陵 黄绿
  if (e < 1500) return [222, 203, 143]
  if (e < 2000) return [226, 195, 139]
  if (e < 3000) return [221, 184, 144] // 山地 浅棕
  if (e < 4000) return [213, 173, 144]
  if (e < 5000) return [200, 160, 148] // 高山 棕红
  return [226, 222, 218] // 极高山 灰白
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
