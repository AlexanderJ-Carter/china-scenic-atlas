import echarts from '@/lib/echarts'
import { projectGeoJson } from '@/lib/projection'

/**
 * GeoJSON 懒加载 + echarts.registerMap 注册。
 * 边界数据来自阿里云 DataV.GeoAtlas，已由 scripts/fetch-geojson.mjs
 * 预先下载到 public/geo/，运行时按需 fetch，不依赖外部 CDN。
 * 坐标系为 GCJ-02，与景区数据坐标一致。
 *
 * 注册前将坐标变换到 Lambert 等角圆锥投影平面（预投影方案，
 * 见 lib/projection.ts），getMapFeatures 仍返回原始经纬度数据。
 */

export interface GeoFeature {
  type: 'Feature'
  properties: {
    adcode?: number
    name?: string
    center?: number[]
    centroid?: number[]
    childrenNum?: number
    [key: string]: unknown
  }
  geometry: unknown
}

export interface GeoJSONFile {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

/**
 * 注册名刻意不用 'china'：ECharts 6 对名为 'china' 的地图有硬编码特殊处理
 * （注入经纬度坐标的「南海诸岛」与台湾附属小岛 region），会与预投影坐标系
 * 冲突污染范围计算。DataV 边界数据本身包含十段线，随投影正常渲染。
 */
export const CHINA_MAP_NAME = 'cn'

/** echarts.registerMap 接受的地图数据类型 */
type EChartsMapSource = Parameters<typeof echarts.registerMap>[1]

const pending = new Map<string, Promise<GeoJSONFile>>()
/** 已加载的地图数据（registerMap 后的本地缓存，用于读取 feature 列表） */
const loaded = new Map<string, GeoJSONFile>()

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

async function fetchJson(path: string): Promise<GeoJSONFile> {
  const res = await fetch(assetUrl(path))
  if (!res.ok) throw new Error(`加载地图边界数据失败: ${path} (HTTP ${res.status})`)
  return (await res.json()) as GeoJSONFile
}

/** 加载并注册全国地图（坐标预投影到 Lambert 圆锥平面），返回注册名 */
export async function ensureChinaMap(): Promise<string> {
  if (loaded.has(CHINA_MAP_NAME)) return CHINA_MAP_NAME
  let p = pending.get(CHINA_MAP_NAME)
  if (!p) {
    p = fetchJson('geo/china.json')
    pending.set(CHINA_MAP_NAME, p)
    forgetFailed(CHINA_MAP_NAME)
  }
  const geo = await p
  if (loaded.has(CHINA_MAP_NAME)) return CHINA_MAP_NAME
  echarts.registerMap(CHINA_MAP_NAME, projectGeoJson(geo) as unknown as EChartsMapSource)
  loaded.set(CHINA_MAP_NAME, geo)
  return CHINA_MAP_NAME
}

/** 加载并注册省份地图（坐标预投影到 Lambert 平面，与全国图同坐标系），返回注册名 */
export async function ensureProvinceMap(adcode: number): Promise<string> {
  const name = String(adcode)
  if (loaded.has(name)) return name
  let p = pending.get(name)
  if (!p) {
    p = fetchJson(`geo/provinces/${name}.json`)
    pending.set(name, p)
    forgetFailed(name)
  }
  const geo = await p
  if (loaded.has(name)) return name
  echarts.registerMap(name, projectGeoJson(geo) as unknown as EChartsMapSource)
  loaded.set(name, geo)
  return name
}

/** 预取省份边界（不注册），用于下钻前的预加载 */
export function prefetchProvinceMap(adcode: number): void {
  const name = String(adcode)
  if (!pending.has(name)) {
    pending.set(name, fetchJson(`geo/provinces/${name}.json`))
    forgetFailed(name)
  }
}

/** 获取已加载地图的 feature 列表（含边界/名称） */
export function getMapFeatures(name: string): GeoFeature[] {
  return loaded.get(name)?.features ?? []
}

/** 地图是否已加载完成（用于决定是否显示加载遮罩） */
export function isMapLoaded(name: string): boolean {
  return loaded.has(name)
}

/**
 * 释放加载失败的 pending 记录，允许下次重试。
 * （否则一次瞬时网络错误会让该地图在本会话内永久无法加载）
 */
function forgetFailed(name: string): void {
  const p = pending.get(name)
  if (p) {
    void p.catch(() => {
      // 仅当仍是同一个失败中的 promise 时清理，避免清掉后来发起的重试
      if (pending.get(name) === p) pending.delete(name)
    })
  }
}
