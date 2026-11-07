/**
 * 地图投影：Lambert 等角圆锥投影（球体），双标准纬线 25°N / 47°N，中央经线 105°E。
 *
 * 相比 ECharts 默认的线性拉伸（aspectScale 0.75），形变更均匀、观感更接近
 * 正式地图产品（国家基本比例尺地图即采用圆锥投影族）。
 *
 * 用法：不依赖 ECharts 的 projection 机制（其自定义投影在区域面渲染上存在
 * 兼容问题），而是「预投影」——GeoJSON 与散点坐标在注册/构建 option 前
 * 先变换到投影平面，ECharts 侧以线性坐标渲染（aspectScale 必须为 1）。
 * 输出为数学坐标系（y 向上、北为正）：ECharts geo 对 GeoJSON 线性数据
 * 的渲染本身遵循「y 向上」的经纬度约定。
 */
const D = Math.PI / 180
const PHI1 = 25 * D
const PHI2 = 47 * D
const PHI0 = 36 * D
const LAMBDA0 = 105 * D
const LCC_N =
  Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2))
const LCC_F = (Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), LCC_N)) / LCC_N
const RHO0 = LCC_F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), LCC_N)

/** 经纬度 → 投影平面（y 向上，北为正） */
export function projectPoint(lng: number, lat: number): [number, number] {
  const p = lat * D
  const rho = LCC_F / Math.pow(Math.tan(Math.PI / 4 + p / 2), LCC_N)
  const theta = LCC_N * (lng * D - LAMBDA0)
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)]
}

/** 投影平面 → 经纬度（roam 反查等场景使用） */
export function unprojectPoint(x: number, y: number): [number, number] {
  const rho = Math.sign(LCC_N) * Math.hypot(x, RHO0 - y)
  const theta = Math.atan2(x, RHO0 - y)
  const lat = (2 * Math.atan(Math.pow(LCC_F / rho, 1 / LCC_N)) - Math.PI / 2) / D
  const lng = (LAMBDA0 + theta / LCC_N) / D
  return [lng, lat]
}

/** 深度遍历 GeoJSON，将全部坐标替换为投影平面坐标（properties 原样保留） */
export function projectGeoJson<T extends object>(geo: T): T {
  const walk = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      return projectPoint(node[0] as number, node[1] as number)
    }
    return node.map(walk)
  }
  return JSON.parse(
    JSON.stringify(geo, (key, value) => (key === 'coordinates' ? walk(value) : value)),
  ) as T
}
