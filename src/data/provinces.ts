import type { ProvinceInfo } from '@/types'

/**
 * 省级行政区元数据表（34 个）。
 * full 与 DataV.GeoAtlas 边界数据 feature.name 一致，
 * adcode 与 https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json 对齐，
 * kind 为行政区划类型（专业表述用：省 / 直辖市 / 自治区 / 特别行政区）。
 * 由 scripts/validate-spots.mjs 在数据校验时核对。
 */
export const PROVINCES: ProvinceInfo[] = [
  { short: '北京', full: '北京市', adcode: 110000, region: '华北', kind: '直辖市' },
  { short: '天津', full: '天津市', adcode: 120000, region: '华北', kind: '直辖市' },
  { short: '河北', full: '河北省', adcode: 130000, region: '华北', kind: '省' },
  { short: '山西', full: '山西省', adcode: 140000, region: '华北', kind: '省' },
  { short: '内蒙古', full: '内蒙古自治区', adcode: 150000, region: '华北', kind: '自治区' },
  { short: '辽宁', full: '辽宁省', adcode: 210000, region: '东北', kind: '省' },
  { short: '吉林', full: '吉林省', adcode: 220000, region: '东北', kind: '省' },
  { short: '黑龙江', full: '黑龙江省', adcode: 230000, region: '东北', kind: '省' },
  { short: '上海', full: '上海市', adcode: 310000, region: '华东', kind: '直辖市' },
  { short: '江苏', full: '江苏省', adcode: 320000, region: '华东', kind: '省' },
  { short: '浙江', full: '浙江省', adcode: 330000, region: '华东', kind: '省' },
  { short: '安徽', full: '安徽省', adcode: 340000, region: '华东', kind: '省' },
  { short: '福建', full: '福建省', adcode: 350000, region: '华东', kind: '省' },
  { short: '江西', full: '江西省', adcode: 360000, region: '华东', kind: '省' },
  { short: '山东', full: '山东省', adcode: 370000, region: '华东', kind: '省' },
  { short: '河南', full: '河南省', adcode: 410000, region: '华中', kind: '省' },
  { short: '湖北', full: '湖北省', adcode: 420000, region: '华中', kind: '省' },
  { short: '湖南', full: '湖南省', adcode: 430000, region: '华中', kind: '省' },
  { short: '广东', full: '广东省', adcode: 440000, region: '华南', kind: '省' },
  { short: '广西', full: '广西壮族自治区', adcode: 450000, region: '华南', kind: '自治区' },
  { short: '海南', full: '海南省', adcode: 460000, region: '华南', kind: '省' },
  { short: '香港', full: '香港特别行政区', adcode: 810000, region: '华南', kind: '特别行政区' },
  { short: '澳门', full: '澳门特别行政区', adcode: 820000, region: '华南', kind: '特别行政区' },
  { short: '台湾', full: '台湾省', adcode: 710000, region: '华东', kind: '省' },
  { short: '重庆', full: '重庆市', adcode: 500000, region: '西南', kind: '直辖市' },
  { short: '四川', full: '四川省', adcode: 510000, region: '西南', kind: '省' },
  { short: '贵州', full: '贵州省', adcode: 520000, region: '西南', kind: '省' },
  { short: '云南', full: '云南省', adcode: 530000, region: '西南', kind: '省' },
  { short: '西藏', full: '西藏自治区', adcode: 540000, region: '西南', kind: '自治区' },
  { short: '陕西', full: '陕西省', adcode: 610000, region: '西北', kind: '省' },
  { short: '甘肃', full: '甘肃省', adcode: 620000, region: '西北', kind: '省' },
  { short: '青海', full: '青海省', adcode: 630000, region: '西北', kind: '省' },
  { short: '宁夏', full: '宁夏回族自治区', adcode: 640000, region: '西北', kind: '自治区' },
  { short: '新疆', full: '新疆维吾尔自治区', adcode: 650000, region: '西北', kind: '自治区' },
]

export const provinceByShort = new Map(PROVINCES.map((p) => [p.short, p]))
export const provinceByFull = new Map(PROVINCES.map((p) => [p.full, p]))
export const provinceByAdcode = new Map(PROVINCES.map((p) => [p.adcode, p]))

/** 大区显示顺序 */
export const REGIONS = ['华北', '东北', '华东', '华中', '华南', '西南', '西北'] as const
