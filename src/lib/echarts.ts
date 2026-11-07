import * as echarts from 'echarts/core'
import { EffectScatterChart, LinesChart, MapChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/**
 * ECharts 按需注册（地图 / 散点 / 涟漪散点 / 线系 / geo 组件 / visualMap / tooltip）
 * 注意：类型（EChartsOption 等）从 'echarts' 以 type-only 方式引入，不会引入运行时代码。
 */
echarts.use([
  MapChart,
  EffectScatterChart,
  ScatterChart,
  LinesChart,
  GeoComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

export default echarts
export type EChartsInstance = ReturnType<typeof echarts.init>
