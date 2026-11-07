export type Level = '5A' | '4A'

/** 景区数据条目（由 scripts/build-spots.mjs 生成 / 校验） */
export interface Spot {
  /** 景区名称 */
  name: string
  /** 评级 */
  level: Level
  /** 省份简称，如「北京」「内蒙古」 */
  province: string
  /** 地级市简称，如「苏州」 */
  city: string
  /** 评级年份（4A 精选数据可能为 null） */
  year: number | null
  /** 分类：自然风光 / 文化遗产 / 红色旅游 / 主题乐园 / 博物馆 / 园林景观 / 现代建筑 / 边境风情 */
  category: string
  /** 一句话介绍 */
  desc?: string
  /** GCJ-02 坐标（与 DataV GeoJSON 底图坐标系一致） */
  lng: number
  lat: number
  /** 是否为文旅部官方评定（港澳为非官方参考收录） */
  official: boolean
  /** 坐标来源说明 */
  coordSource?: string
  /** 备注（如港澳非官方评定说明） */
  note?: string
}

/** 省级行政区元数据（与 DataV GeoJSON adcode 对齐） */
export interface ProvinceInfo {
  /** 简称，与 Spot.province 对齐，如「北京」 */
  short: string
  /** 全称，与 GeoJSON feature.name 对齐，如「北京市」 */
  full: string
  /** DataV adcode */
  adcode: number
  /** 大区：华北/东北/华东/华中/华南/西南/西北 */
  region: string
  /** 行政区划类型：省 / 直辖市 / 自治区 / 特别行政区 */
  kind: string
}

/** 数据集元信息（build 脚本生成） */
export interface DataMeta {
  generatedAt: string
  spotCount5A: number
  /** 大陆官方评定数（不含港澳参考条目） */
  mainland5A?: number
  spotCount4A: number
  sources: { name: string; url: string }[]
  notes: string[]
}

/** 自然地理标注（地貌模式用） */
export type TerrainMarker = {
  name: string
  lng: number
  lat: number
  type: 'range' | 'plateau' | 'basin' | 'desert' | 'peak' | 'lake'
}

export type View =
  | { mode: 'national' }
  | { mode: 'province'; adcode: number; short: string; full: string; kind: string }
