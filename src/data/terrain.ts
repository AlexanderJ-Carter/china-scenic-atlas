import type { TerrainMarker } from '@/types'

/**
 * 自然地理标注（山脉/高原/盆地/沙漠/山峰），坐标 WGS-84，经多代理调研核对
 * （维基百科 infobox / Wikidata）。用于地貌模式的地图文字标注。
 */
export const TERRAIN_MARKERS: TerrainMarker[] = [
  { name: '喜马拉雅山脉', lng: 82.0, lat: 28.8, type: 'range' },
  { name: '昆仑山脉', lng: 80.9, lat: 35.3, type: 'range' },
  { name: '天山山脉', lng: 80.1, lat: 42, type: 'range' },
  { name: '秦岭', lng: 107.6, lat: 34, type: 'range' },
  { name: '大兴安岭', lng: 123.2, lat: 49.4, type: 'range' },
  { name: '太行山脉', lng: 113, lat: 38, type: 'range' },
  { name: '横断山脉', lng: 99, lat: 27.5, type: 'range' },
  { name: '祁连山脉', lng: 98.5, lat: 39.2, type: 'range' },
  { name: '阿尔泰山脉', lng: 89, lat: 49, type: 'range' },
  { name: '阴山', lng: 112, lat: 41, type: 'range' },
  { name: '长白山脉', lng: 128, lat: 42, type: 'range' },
  { name: '武夷山脉', lng: 117.7, lat: 27.7, type: 'range' },
  { name: '南岭', lng: 112.3, lat: 25.2, type: 'range' },
  { name: '大巴山', lng: 109.5, lat: 32, type: 'range' },
  { name: '冈底斯山脉', lng: 84.6, lat: 29.8, type: 'range' },
  { name: '阿尔金山脉', lng: 90.1, lat: 38.3, type: 'range' },
  { name: '青藏高原', lng: 88, lat: 33, type: 'plateau' },
  { name: '内蒙古高原', lng: 114.4, lat: 43.6, type: 'plateau' },
  { name: '黄土高原', lng: 108.7, lat: 36.9, type: 'plateau' },
  { name: '云贵高原', lng: 105, lat: 27, type: 'plateau' },
  { name: '塔克拉玛干沙漠', lng: 82.2, lat: 38.9, type: 'desert' },
  { name: '准噶尔盆地', lng: 85, lat: 45, type: 'basin' },
  { name: '塔里木盆地', lng: 83, lat: 39, type: 'basin' },
  { name: '柴达木盆地', lng: 94.5, lat: 37.7, type: 'basin' },
  { name: '四川盆地', lng: 105.5, lat: 30.5, type: 'basin' },
  { name: '吐鲁番盆地', lng: 89.3, lat: 42.8, type: 'basin' },
  { name: '东北平原', lng: 123.3, lat: 44.5, type: 'range' },
  { name: '珠穆朗玛峰 8848m', lng: 86.9, lat: 28, type: 'peak' },
  { name: '青海湖', lng: 100.1, lat: 37, type: 'lake' },
]

/** 河流名（与 public/data/rivers.json 键一致） */
export const RIVER_LABELS = [
  '长江',
  '黄河',
  '珠江',
  '黑龙江',
  '塔里木河',
  '澜沧江',
  '怒江',
  '雅鲁藏布江',
  '淮河',
  '雅砻江',
]
