import echarts, { type EChartsInstance } from '@/lib/echarts'
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'

/**
 * ECharts 实例生命周期管理：挂载初始化、容器尺寸自适应（去抖）、卸载销毁。
 */
export function useChart(elRef: Ref<HTMLElement | undefined>) {
  const chart = shallowRef<EChartsInstance | null>(null)
  let observer: ResizeObserver | null = null
  let resizeFrame = 0
  let width = 0
  let height = 0

  onMounted(() => {
    const el = elRef.value
    if (!el) return
    chart.value = echarts.init(el, undefined, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    })
    width = el.clientWidth
    height = el.clientHeight
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (el.clientWidth === width && el.clientHeight === height) return
        width = el.clientWidth
        height = el.clientHeight
        if (width && height) chart.value?.resize({ width, height })
      })
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(resizeFrame)
    observer?.disconnect()
    observer = null
    chart.value?.dispose()
    chart.value = null
  })

  return chart
}
