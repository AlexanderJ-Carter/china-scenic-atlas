import type { EChartsOption } from 'echarts'
import type { Spot, View } from '@/types'
import { PROVINCES, provinceByFull, provinceByShort } from '@/data/provinces'
import { TERRAIN_MARKERS } from '@/data/terrain'
import { chartPalette, terrainColor, theme } from '@/lib/theme'
import { categoryStyle } from '@/lib/icons'
import { projectPoint } from '@/lib/projection'
import { isVisited } from '@/lib/visited'
import { getRivers } from '@/lib/rivers'
import type { GeoFeature } from '@/composables/geo'

/**
 * ECharts 地图 option 构建器。
 *
 * 全国按省计数，省份视图使用全国背景 geo 与省级前景 geo。
 * MapPanel 管理视图切换、系列替换与用户漫游状态。
 *
 * 坐标：GCJ-02，与 DataV GeoJSON 底图一致；底图与散点在注册/构建前统一经
 * Lambert 等角圆锥投影变换（见 lib/projection.ts），ECharts 以线性坐标渲染。
 * 性能：全国视图 5A 涟漪仅在悬停时渲染（showEffectOn: 'emphasis'），
 * 避免全国和省份空闲时逐帧重绘；4A 散点开启 progressive。
 */

/** tooltip formatter 收到的参数（结构化子集） */
interface TipParams {
  seriesType?: string
  seriesName?: string
  componentType?: string
  name?: string
  value?: number | number[] | string
  data?: { name?: string; value?: number | number[]; spot?: Spot }
}

export interface BuildOptionArgs {
  view: View
  /** 经筛选后的可见景区 */
  spots: Spot[]
  /** 当前地图的全部 feature（聚焦时为省级市级 features，原始经纬度） */
  features: GeoFeature[]
  /** 注册的地图名（全国 'cn' 或省级 adcode 字符串） */
  mapName: string
  /** 视图切换时显式携带的 geo 缩放状态（省略则保留现有缩放） */
  focus?: { zoom?: number; center?: [number, number] }
  /** 底图模式：统计（choropleth）或 地形（DEM 晕渲 + 大区配色） */
  mapMode?: 'stat' | 'terrain'
}

/* ---------------- 投影对角线（双 geo 缩放比例） ---------------- */

interface GeoLike {
  type: string
  coordinates: unknown
}

/** 省级 features 的投影对角线（双 geo 缩放比例计算） */
const diagonalCache = new WeakMap<GeoFeature[], number>()
function provinceProjDiag(features: GeoFeature[]): number {
  const cached = diagonalCache.get(features)
  if (cached !== undefined) return cached
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = projectPoint(node[0] as number, node[1] as number)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      return
    }
    for (const child of node) walk(child)
  }
  for (const f of features) {
    const g = f.geometry as GeoLike | undefined
    if (g) walk(g.coordinates)
  }
  if (minX === Infinity) return 1
  const diagonal = Math.max(Math.hypot(maxX - minX, maxY - minY), 1e-6)
  diagonalCache.set(features, diagonal)
  return diagonal
}

/** 中国大陆范围的投影对角线（按地理 bbox 边界采样） */
let chinaDiagonal: number | undefined
function chinaProjDiag(): number {
  if (chinaDiagonal !== undefined) return chinaDiagonal
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const W = 73.5
  const E = 135.5
  const S = 17.5
  const N = 53.8
  for (let lng = W; lng <= E; lng += 0.5) {
    for (const lat of [S, N]) {
      const [x, y] = projectPoint(lng, lat)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  for (let lat = S; lat <= N; lat += 0.5) {
    for (const lng of [W, E]) {
      const [x, y] = projectPoint(lng, lat)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  chinaDiagonal = Math.hypot(maxX - minX, maxY - minY)
  return chinaDiagonal
}

/* ---------------- 聚合 ---------------- */

/** 按省级区域聚合景区数量（全国视图 choropleth） */
export function countByProvince(spots: Spot[]) {
  const counts = new Map<string, number>()
  for (const p of PROVINCES) counts.set(p.full, 0)
  for (const s of spots) {
    const p = provinceByShort.get(s.province)
    if (p) counts.set(p.full, (counts.get(p.full) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value }))
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function spotTooltipHtml(spot: Spot, p: { text: string; subText: string }): string {
  const badgeBg = spot.level === '5A' ? '#ea9c0f' : '#0d9488'
  const lines = [
    `<div style="margin:2px 0 6px;color:${p.subText};font-size:12px;">`,
    `${escapeHtml(spot.province)}${spot.city && spot.city !== spot.province ? ` · ${escapeHtml(spot.city)}` : ''}`,
    spot.year ? ` · ${spot.year}年评定` : '',
    `</div>`,
  ]
  if (spot.category) {
    lines.push(
      `<div style="color:${p.subText};font-size:12px;">${categoryStyle(spot.category).icon} ${escapeHtml(spot.category)}</div>`,
    )
  }
  if (spot.note) {
    lines.push(
      `<div style="margin-top:4px;color:#c9a34a;font-size:11px;">※ ${escapeHtml(spot.note)}</div>`,
    )
  }
  return [
    `<div style="min-width:180px;">`,
    `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${badgeBg};margin-right:6px;">${spot.level}</span>`,
    `<span style="font-size:14px;font-weight:600;color:${p.text === '#243447' ? '#1f2d3d' : '#fff'};">${escapeHtml(spot.name)}</span>`,
    ...lines,
    `</div>`,
  ].join('')
}

function regionTooltipHtml(
  name: string,
  count: number,
  spots: Spot[],
  hint: '' | 'focus' | 'switch' | 'current' | 'taiwan',
  p: { text: string; subText: string },
): string {
  const list = spots.slice(0, 5)
  const items = list
    .map(
      (s) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:3px;">` +
        `<span style="color:${p.text};">${s.level === '5A' ? '★' : '·'} ${escapeHtml(s.name)}</span>` +
        `<span style="color:${p.subText};font-size:11px;">${s.year ?? ''}</span></div>`,
    )
    .join('')
  const more =
    spots.length > 5
      ? `<div style="color:${p.subText};margin-top:3px;">… 共 ${spots.length} 家</div>`
      : ''
  const hints: Record<string, string> = {
    focus: '点击进入该区域地图',
    switch: '点击切换到该区域',
    current: '当前区域',
    taiwan: '暂未收录台湾景区数据',
    '': '',
  }
  const hintText = hints[hint] ?? ''
  const hintHtml = hintText
    ? `<div style="margin-top:6px;color:${p.subText};font-size:11px;">${hintText}</div>`
    : ''
  return (
    `<div style="min-width:190px;">` +
    `<div style="font-size:14px;font-weight:600;color:${p.text === '#243447' ? '#1f2d3d' : '#fff'};">${escapeHtml(name)}</div>` +
    (count > 0
      ? `<div style="margin:4px 0 6px;color:#0d9488;font-size:12px;">在筛选范围内共 ${count} 家景区</div>`
      : '') +
    items +
    more +
    hintHtml +
    `</div>`
  )
}

/** 按市级 feature 聚合景区数量（省级聚焦视图 choropleth） */
export function countByCityFeatures(spots: Spot[], features: GeoFeature[]) {
  const featureNames = features
    .map((f) => f.properties?.name)
    .filter((n): n is string => Boolean(n))
  const counts = new Map<string, number>()
  for (const name of featureNames) counts.set(name, 0)
  for (const s of spots) {
    const hit = featureNames.find(
      (n) => n === s.city || n.startsWith(s.city) || s.city.startsWith(n),
    )
    if (s.city && hit) counts.set(hit, (counts.get(hit) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value }))
}

/** hex → rgba 字符串 */
function withAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 河流线系列（数据由 lib/rivers.ts 懒加载后注入） */
function buildRiverSeries(geoIdx: number): Record<string, unknown> {
  const rivers = getRivers()
  const data = []
  for (const [, segs] of Object.entries(rivers)) {
    for (const seg of segs) {
      data.push({ coords: seg.map((c) => projectPoint(c[0], c[1])) })
    }
  }
  return {
    id: '河流',
    name: '河流',
    type: 'lines',
    coordinateSystem: 'geo',
    geoIndex: geoIdx,
    polyline: true,
    silent: true,
    lineStyle: { color: 'rgba(66, 133, 194, 0.65)', width: 1.6, curveness: 0 },
    progressive: 500,
    z: 3,
    data,
  }
}

/** 山脉/地理标注系列（symbol 山峰▲ + 文字） */
function buildTerrainLabelSeries(geoIdx: number): Record<string, unknown> {
  return {
    id: '地理标注',
    name: '地理标注',
    type: 'scatter',
    coordinateSystem: 'geo',
    geoIndex: geoIdx,
    silent: true,
    symbolSize: 0,
    label: {
      show: true,
      formatter: (p: { data: { name: string; type: string } }) => {
        const icon = p.data.type === 'peak' ? '▲ ' : p.data.type === 'desert' ? '〰 ' : ''
        return `${icon}${p.data.name}`
      },
      position: 'inside',
      color: 'rgba(90, 72, 45, 0.85)',
      fontSize: 10.5,
      fontWeight: 500,
      textBorderWidth: 2,
      textBorderColor: 'rgba(255, 255, 255, 0.75)',
    },
    data: TERRAIN_MARKERS.map((m) => ({
      name: m.name,
      type: m.type,
      value: projectPoint(m.lng, m.lat),
    })),
    z: 4,
  }
}

/** 是否遵循系统减少动态效果偏好（前庭安全） */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

const pointCache = new WeakMap<Spot, [number, number]>()
function spotPoint(spot: Spot): [number, number] {
  let point = pointCache.get(spot)
  if (!point) {
    point = projectPoint(spot.lng, spot.lat)
    pointCache.set(spot, point)
  }
  return point
}

export function buildMapOption(args: BuildOptionArgs): EChartsOption {
  const { view, focus, mapName } = args
  const isNational = view.mode === 'national'
  const terrain = args.mapMode === 'terrain'
  const reduced = prefersReducedMotion()
  const pal = chartPalette()
  // 聚焦省级视图：只显示当前区域的散点
  const spots = isNational ? args.spots : args.spots.filter((s) => s.province === view.short)
  const spots5a = spots.filter((s) => s.level === '5A')
  const spots4a = spots.filter((s) => s.level === '4A')

  // choropleth：全国按省计数，聚焦按市级计数（省图的 features 是市级行政区）
  const choropleth = isNational
    ? countByProvince(args.spots)
    : countByCityFeatures(spots, args.features)
  const maxCount = Math.max(1, ...choropleth.map((d) => d.value))

  const spotsInRegion = (name: string) => {
    const province = provinceByFull.get(name)
    if (province) return args.spots.filter((s) => s.province === province.short)
    if (isNational) return []
    // 省级视图：按市名聚合
    return spots.filter(
      (s) =>
        Boolean(s.city) && (name === s.city || name.startsWith(s.city) || s.city.startsWith(name)),
    )
  }

  const tooltipFormatter = (raw: unknown): string => {
    const p = raw as TipParams
    if (p.seriesName === '5A景区' || p.seriesName === '4A景区') {
      const spot = p.data?.spot
      return spot ? spotTooltipHtml(spot, pal) : String(p.name ?? '')
    }
    // geo / map 系列：区域汇总
    const name = String(p.name ?? '')
    const prov = provinceByFull.get(name)
    let hint: '' | 'focus' | 'switch' | 'current' | 'taiwan' = ''
    if (prov) {
      if (prov.adcode === 710000) hint = 'taiwan'
      else if (isNational) hint = 'focus'
      else hint = view.mode === 'province' && view.full === name ? 'current' : 'switch'
    }
    const regionSpots = spotsInRegion(name)
    return regionTooltipHtml(name, regionSpots.length, regionSpots, hint, pal)
  }

  const scatterData5a = spots5a.map((s) => ({
    name: s.name,
    value: spotPoint(s),
    spot: s,
    // 已打卡：放大 + 红色描边环
    ...(isVisited(s.name)
      ? {
          symbolSize: (isNational ? 6.5 : 9) * 1.5,
          itemStyle: { borderColor: '#e05252', borderWidth: 2.5 },
        }
      : {}),
  }))
  const scatterData4a = spots4a.map((s) => ({
    name: s.name,
    value: spotPoint(s),
    spot: s,
    ...(isVisited(s.name)
      ? {
          symbolSize: (isNational ? 4.5 : 6) * 1.6,
          itemStyle: { borderColor: '#e05252', borderWidth: 2.5 },
        }
      : {}),
  }))

  // 区域配色：地形模式全国图（半透明让晕渲地形透出 + 省名标注）；
  // 聚焦省级图不需要 regions（市级 choropleth 由 map series data 驱动，
  // 市级行政区就是底图 feature）
  let regions: Array<Record<string, unknown>> | undefined
  if (terrain && isNational) {
    regions = PROVINCES.map((p) => ({
      name: p.full,
      itemStyle: {
        areaColor: withAlpha(
          terrainColor(p.region, p.adcode),
          theme.mode === 'light' ? 0.42 : 0.55,
        ),
        borderColor: withAlpha(pal.border, 0.85),
        borderWidth: 1.2,
      },
      // 地形模式显示省名（半透明、不抢地形）——真地图样式
      label: {
        show: true,
        color: theme.mode === 'light' ? 'rgba(70, 62, 50, 0.62)' : 'rgba(225, 235, 245, 0.55)',
        fontSize: 10,
        fontWeight: 500,
      },
    }))
  }

  // 前景 geo index（全国=0，聚焦=双 geo 前景=1），所有 series 绑定前景
  const geoIdx = isNational ? 0 : 1

  // 地貌模式叠加层：河流（线）+ 山脉/地理标注（文字）
  const riverSeries = terrain ? buildRiverSeries(geoIdx) : undefined
  const terrainLabelSeries = terrain ? buildTerrainLabelSeries(geoIdx) : undefined

  const geoBase: Record<string, unknown> = {
    map: mapName,
    roam: true,
    scaleLimit: { min: 0.85, max: 16 },
    // 底图已预投影为平面坐标，比例由投影本身保证，必须保持 1
    aspectScale: 1,
    layoutCenter: ['50%', '52%'],
    layoutSize: '96%',
    itemStyle: {
      areaColor: {
        type: 'linear',
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: pal.areaTop },
          { offset: 1, color: pal.areaBottom },
        ],
      },
      borderColor: pal.border,
      borderWidth: 1,
      shadowColor: 'rgba(20, 70, 120, 0.3)',
      shadowBlur: 12,
    },
    emphasis: {
      disabled: false,
      itemStyle: { areaColor: pal.emphasis, borderColor: pal.border },
      label: { show: true, color: pal.label, fontSize: 11 },
    },
    // 聚焦省级图：显示市名标注（行政区划细节）；全国图默认不显示（地形模式 regions 单独配置）
    label: {
      show: !isNational,
      color: pal.label,
      fontSize: isNational ? 11 : 10,
    },
    select: { disabled: true },
    regions: regions ?? [],
  }

  // 聚焦视图：双 geo —— 背景全国图（邻省淡化显示，可点击切换）+ 前景省图
  // 全国背景的 zoom 按比例缩放（像素比例与省图前景一致，坐标系同为 Lambert 平面）
  let geoArray: Array<Record<string, unknown>>
  if (isNational) {
    geoArray = [geoBase]
  } else {
    const ratio = chinaProjDiag() / provinceProjDiag(args.features)
    const bgGeo: Record<string, unknown> = {
      map: 'cn',
      roam: false,
      silent: false,
      aspectScale: 1,
      layoutCenter: ['50%', '52%'],
      layoutSize: '96%',
      zoom: 1.1 * ratio,
      center: geoBase.center,
      itemStyle: {
        areaColor: withAlpha(pal.dimArea, 0.55),
        borderColor: withAlpha(pal.dimBorder, 0.8),
        borderWidth: 0.8,
      },
      emphasis: { disabled: true },
      label: { show: false },
      select: { disabled: true },
    }
    geoBase.zoom = 1.1
    geoArray = [bgGeo, geoBase]
  }
  if (focus) {
    if (focus.zoom !== undefined) geoBase.zoom = focus.zoom
    if (focus.center !== undefined) geoBase.center = focus.center
  }

  return {
    backgroundColor: 'transparent',
    animation: !reduced,
    animationDuration: 260,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 180,
    animationEasingUpdate: 'cubicInOut',
    tooltip: {
      trigger: 'item',
      backgroundColor: pal.tooltipBg,
      borderColor: pal.tooltipBorder,
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: pal.tooltipText, fontSize: 13 },
      extraCssText:
        'backdrop-filter:blur(6px);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,0.25);',
      formatter: tooltipFormatter,
    },
    visualMap: {
      type: 'continuous',
      // 地形模式解除与 map series 的绑定（seriesIndex 指向不存在的系列），
      // 区域颜色回落到 geo.regions 半透明地貌色；data 保留 choropleth
      // —— 空 data 会导致 map series 区域点击事件失效（聚焦不可用）
      seriesIndex: terrain ? 999 : 0,
      min: 0,
      max: maxCount,
      left: 18,
      bottom: 28,
      itemHeight: 110,
      text: ['多', '少'],
      calculable: true,
      inRange: { color: pal.ramp },
      textStyle: { color: pal.subText, fontSize: 11 },
      show: isNational && !terrain,
    },
    geo: geoArray as never,
    series: [
      ...(riverSeries ? [riverSeries] : []),
      ...(terrainLabelSeries ? [terrainLabelSeries] : []),
      {
        id: '景区分布',
        name: '景区分布',
        type: 'map',
        geoIndex: geoIdx,
        // data 始终保留（空 data 会使区域点击失效）；地形模式由 visualMap
        // 解除绑定，区域颜色回落到 geo.regions 地貌色
        data: choropleth,
      },
      {
        id: '5A景区',
        name: '5A景区',
        // 减少动态效果偏好：退化为静态散点（无涟漪）
        type: reduced ? 'scatter' : 'effectScatter',
        coordinateSystem: 'geo',
        geoIndex: geoIdx,
        data: scatterData5a,
        symbolSize: isNational ? 6.5 : 9,
        // 全国视图点位多：涟漪仅悬停时渲染，避免整层 canvas 逐帧重绘
        showEffectOn: 'emphasis',
        rippleEffect: { brushType: 'stroke', scale: 3.2, period: 4 },
        itemStyle: {
          color: pal.level5a,
          shadowBlur: 6,
          shadowColor: pal.level5aGlow,
          borderColor: 'rgba(255,255,255,0.85)',
          borderWidth: 1,
        },
        emphasis: { scale: 1.7 },
        z: 6,
      },
      {
        id: '4A景区',
        name: '4A景区',
        type: 'scatter',
        coordinateSystem: 'geo',
        geoIndex: geoIdx,
        data: scatterData4a,
        symbolSize: isNational ? 4.5 : 6,
        // 全量 4A 数百点：progressive 分块渲染避免长帧
        progressive: 300,
        progressiveThreshold: 600,
        itemStyle: {
          color: pal.level4a,
          borderColor: pal.level4aBorder,
          borderWidth: 1,
        },
        emphasis: { scale: 1.8 },
        z: 7,
      },
    ],
  } as EChartsOption
}
