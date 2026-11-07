<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { EChartsInstance } from '@/lib/echarts'
import { useChart } from '@/composables/useChart'
import {
  CHINA_MAP_NAME,
  ensureChinaMap,
  ensureProvinceMap,
  getMapFeatures,
  isMapLoaded,
} from '@/composables/geo'
import { buildMapOption, prefersReducedMotion } from '@/lib/mapOptions'
import { visibleSpots } from '@/lib/filter'
import { ensureRiversLoaded } from '@/lib/rivers'
import { theme } from '@/lib/theme'
import { visited } from '@/lib/visited'
import { state } from '@/state'
import { provinceByFull } from '@/data/provinces'
import type { Spot } from '@/types'

const el = ref<HTMLElement>()
const terrainCanvas = ref<HTMLCanvasElement>()
const chart = useChart(el)
const loading = ref(false)
const transitionCanvas = ref<HTMLCanvasElement>()
let transitionAnimation: Animation | undefined
type Camera = { zoom?: number; center?: number[] }
const cameras = new Map<string, Camera[]>()
const loadError = ref('')
let disposed = false
let appliedMap = ''
/** 筛选变化的重渲染按帧合并（年份滑块拖动会高频触发） */
let renderFrame = 0
let renderToken = 0

/* ---------------- 晕渲地形层 ---------------- */

let hillshadeImg: HTMLImageElement | null = null
let hillshadeMeta: {
  x0: number
  y0: number
  x1: number
  y1: number
  width: number
  height: number
} | null = null
let hillshadeLoaded = false
let terrainTransform = ''

async function loadHillshade(): Promise<void> {
  if (hillshadeLoaded) return
  hillshadeLoaded = true
  try {
    const [img, metaRes] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => reject(new Error('hillshade 图片加载失败'))
        im.src = new URL('data/hillshade.png', document.baseURI).href
      }),
      fetch(new URL('data/hillshade-meta.json', document.baseURI).href),
    ])
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`)
    hillshadeMeta = (await metaRes.json()) as typeof hillshadeMeta
    hillshadeImg = img
    drawHillshade()
  } catch (err) {
    console.warn('[MapPanel] 晕渲地形加载失败', err)
    hillshadeLoaded = false
  }
}

/** 按当前 geo 视图变换绘制晕渲层（Lambert bbox 四角 → 像素坐标） */
function drawHillshade(): void {
  const cv = terrainCanvas.value
  const inst = chart.value
  if (!cv || !inst || !hillshadeImg || !hillshadeMeta) return
  const m = hillshadeMeta
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = cv.getBoundingClientRect()
  if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    terrainTransform = ''
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  try {
    const p00 = inst.convertToPixel({ geoIndex: 0 }, [m.x0, m.y0]) as number[]
    const p11 = inst.convertToPixel({ geoIndex: 0 }, [m.x1, m.y1]) as number[]
    if (!p00 || !p11) return
    const sx = (p11[0] - p00[0]) / m.width
    const sy = (p11[1] - p00[1]) / m.height
    if (Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) return
    const transform = [dpr, rect.width, rect.height, ...p00, ...p11].join(',')
    if (transform === terrainTransform) return
    terrainTransform = transform
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(hillshadeImg, p00[0], p00[1], p11[0] - p00[0], p11[1] - p00[1])
  } catch {
    /* geo 未就绪时忽略 */
  }
}

function applyOption(viewChanged: boolean, reset = false): void {
  const token = ++renderToken
  const inst = chart.value
  if (!inst || disposed) return
  const view = state.view
  loadError.value = ''
  const targetMap = view.mode === 'national' ? CHINA_MAP_NAME : String(view.adcode)
  loading.value = !isMapLoaded(targetMap)
  // 聚焦 = 切换到省级地图（市级边界为底图实体），懒加载该省 GeoJSON
  const mapReady = Promise.all([
    ensureChinaMap(),
    ...(view.mode === 'province' ? [ensureProvinceMap(view.adcode)] : []),
  ])
  void mapReady
    .then(() => {
      // 并发的渲染（快速切换）只保留最后一次
      if (token !== renderToken || disposed) return
      const mapName = view.mode === 'national' ? CHINA_MAP_NAME : String(view.adcode)
      const features = getMapFeatures(mapName)
      const option = buildMapOption({
        view,
        spots: visibleSpots.value,
        features,
        mapName,
        mapMode: state.mapMode,
      })
      const previous = inst.getOption()?.geo as Camera[] | undefined
      if (viewChanged || appliedMap !== mapName) {
        if (appliedMap && appliedMap !== mapName && previous) {
          cameras.set(
            appliedMap,
            previous.map(({ zoom, center }) => ({ zoom, center })),
          )
        }
        if (reset) cameras.delete(mapName)
        const saved = cameras.get(mapName)
        if (saved) (option.geo as Camera[]).forEach((geo, i) => Object.assign(geo, saved[i]))
        captureTransition()
        // 视图切换：geo + series 全量替换（merge 会残留聚焦时的双 geo 与旧 zoom，
        // replaceMerge 保证干净切换且保留 ECharts 更新动画）
        resetBgRatio()
        inst.setOption(option, { replaceMerge: ['geo', 'series'] })
        const geos = option.geo as Camera[]
        bgRatioCache = geos.length > 1 ? (geos[0].zoom ?? 1) / (geos[1].zoom ?? 1) : 0
      } else {
        const geos = option.geo as Array<{ zoom?: number; center?: number[] }>
        geos.forEach((geo, index) => {
          geo.zoom = previous?.[index]?.zoom
          geo.center = previous?.[index]?.center
        })
        inst.setOption(option, { replaceMerge: ['series'] })
      }
      // 地形模式：重绘晕渲层（Lambert 平面统一，随新地图的 geo 变换同步）
      appliedMap = mapName
      if (state.mapMode === 'terrain') drawHillshade()
    })
    .catch((err) => {
      if (token !== renderToken || disposed) return
      loadError.value = '地图加载失败，请重试'
      console.error('[MapPanel] 地图渲染失败', err)
    })
    .finally(() => {
      if (token === renderToken) loading.value = false
    })
}

/** 视图切换立即渲染；纯筛选变化（年份拖动等）按帧合并 */
function scheduleRender(viewChanged: boolean): void {
  if (disposed) return
  if (viewChanged) {
    cancelAnimationFrame(renderFrame)
    renderFrame = 0
    applyOption(true)
    return
  }
  if (renderFrame) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0
    applyOption(false)
  })
}

function resetBgRatio(): void {
  bgRatioCache = 0
}

/** 切换时仅复制一次旧画布，用合成层淡出，避免逐帧重建地图。 */
function captureTransition(): void {
  transitionAnimation?.cancel()
  const canvas = transitionCanvas.value
  const container = el.value
  if (!canvas || !container || !appliedMap || prefersReducedMotion()) return
  const rect = container.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(dpr, dpr)
  const layers = [...container.querySelectorAll('canvas')]
  if (state.mapMode === 'terrain' && terrainCanvas.value) layers.unshift(terrainCanvas.value)
  for (const layer of layers) {
    if (layer.width && layer.height) context.drawImage(layer, 0, 0, rect.width, rect.height)
  }
  transitionAnimation = canvas.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 240,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  })
}

function resetView(): void {
  applyOption(true, true)
}

interface ChartClickParams {
  componentType?: string
  seriesType?: string
  geoIndex?: number
  name?: string
  data?: { spot?: Spot }
}

function attachEvents(inst: EChartsInstance): void {
  // 暴露给 e2e 冒烟测试（scripts/e2e-smoke.mjs）使用
  ;(window as unknown as Record<string, unknown>).__scenicChart = inst
  inst.on('click', (raw: unknown) => {
    const p = raw as ChartClickParams
    // 点击景区散点 → 打开详情
    if (p.data?.spot) {
      state.selectedSpot = p.data.spot
      return
    }
    // 聚焦视图：点击背景层（geoIndex 0 全国图）的邻省区域 → 直接切换省份
    if (state.view.mode === 'province' && p.componentType === 'geo' && p.geoIndex === 0) {
      const prov = provinceByFull.get(String(p.name))
      if (prov && prov.adcode !== 710000 && prov.full !== state.view.full) {
        state.view = {
          mode: 'province',
          adcode: prov.adcode,
          short: prov.short,
          full: prov.full,
          kind: prov.kind,
        }
      }
      return
    }
    // 全国视图：点击省份 → 进入省级图
    if (state.view.mode === 'national' && (p.componentType === 'geo' || p.seriesType === 'map')) {
      const prov = provinceByFull.get(String(p.name))
      if (prov && prov.adcode !== 710000) {
        state.view = {
          mode: 'province',
          adcode: prov.adcode,
          short: prov.short,
          full: prov.full,
          kind: prov.kind,
        }
      }
    }
  })
  // 漫游（拖拽/缩放）：同步晕渲层 + 聚焦视图的双 geo 背景层缩放
  inst.on('rendered', () => {
    if (state.mapMode === 'terrain') drawHillshade()
  })
  inst.on('georoam', () => {
    if (state.view.mode === 'province') syncBgGeoZoom(inst)
    if (state.mapMode === 'terrain') drawHillshade()
  })
}

/** 聚焦视图双 geo 同步：背景全国图的 zoom = 前景 zoom × 比例 */
function syncBgGeoZoom(inst: EChartsInstance): void {
  try {
    const opt = inst.getOption() as {
      geo?: Array<{ zoom?: number; center?: number[] }>
    }
    const geos = opt.geo ?? []
    if (geos.length < 2) return
    const [bg, fg] = geos
    if (!fg.zoom) return
    // 比例 = 背景 zoom / 前景 zoom（初始化时的比值，保持不变）
    const ratio = bgRatioCache || (bg.zoom ?? 1) / fg.zoom
    bgRatioCache = ratio
    inst.setOption({
      geo: [{ zoom: fg.zoom * ratio, center: fg.center }, {}],
    })
  } catch {
    /* 忽略 */
  }
}

let bgRatioCache = 0

watch(chart, (inst) => {
  if (!inst) return
  attachEvents(inst)
  applyOption(true)
})

// 视图/数据变化时重渲染（视图切换全量替换 + 焦距动画，筛选变化增量合并保留缩放）
watch(
  () => [state.view, visibleSpots.value] as const,
  ([view], [prevView]) => {
    scheduleRender(view !== prevView)
  },
)

// 主题切换：增量合并（保留缩放），仅换配色
watch(
  () => theme.mode,
  () => scheduleRender(false),
)

// 底图模式切换（统计 ↔ 地形）：地形模式按需加载晕渲/河流
watch(
  () => state.mapMode,
  (mode) => {
    if (mode === 'terrain') {
      void loadHillshade()
      void ensureRiversLoaded().then(() => scheduleRender(false))
    }
    scheduleRender(false)
  },
)

// 打卡变化：增量重绘散点标记（已打卡的加红色描边环）
watch(
  () => visited.names.size,
  () => scheduleRender(false),
)
onBeforeUnmount(() => {
  disposed = true
  renderToken++
  cancelAnimationFrame(renderFrame)
  transitionAnimation?.cancel()
  delete (window as unknown as Record<string, unknown>).__scenicChart
})
</script>

<template>
  <div class="map-panel" :aria-busy="loading">
    <canvas
      ref="terrainCanvas"
      class="terrain-layer"
      :class="{ visible: state.mapMode === 'terrain' }"
    ></canvas>
    <div ref="el" class="chart"></div>
    <canvas ref="transitionCanvas" class="transition-layer" aria-hidden="true"></canvas>
    <Transition name="fade">
      <div v-if="loading" class="loading">
        <span class="spinner"></span>
        <span>正在加载边界数据…</span>
      </div>
    </Transition>
    <div v-if="loadError" class="loading" role="alert">
      <span>{{ loadError }}</span>
      <button @click="applyOption(true)">重试</button>
    </div>
    <div class="mode-toggle" role="group" aria-label="底图模式">
      <button
        class="mode-btn"
        :class="{ on: state.mapMode === 'stat' }"
        title="按景区数量分级着色"
        @click="state.mapMode = 'stat'"
      >
        统计
      </button>
      <button
        class="mode-btn"
        :class="{ on: state.mapMode === 'terrain' }"
        title="真实地形（DEM 晕渲 + 分层设色 + 河流山脉）"
        @click="state.mapMode = 'terrain'"
      >
        地形
      </button>
    </div>
    <button class="reset-view utility-button" @click="resetView">恢复视角</button>
    <div v-if="state.view.mode === 'national'" class="hint">
      <span class="desktop-hint">滚轮缩放 · 拖拽平移 · </span>点击省级行政区进入省图
    </div>
    <button
      v-else
      class="back-btn"
      title="返回全国视图 (Esc)"
      @click="state.view = { mode: 'national' }"
    >
      ← 返回全国
    </button>
  </div>
</template>

<style scoped>
@media (pointer: coarse) {
  .desktop-hint {
    display: none;
  }
}
.reset-view {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 4;
}
.hint,
.back-btn {
  z-index: 4;
}
.map-panel {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--map-bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow 0.4s ease,
    border-color 0.3s ease;
}

.transition-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  z-index: 2;
}

.chart {
  width: 100%;
  height: 100%;
  position: relative;
  z-index: 1;
}

.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--sub);
  font-size: 13px;
  background: color-mix(in srgb, var(--bg) 45%, transparent);
  backdrop-filter: blur(2px);
  z-index: 5;
}

.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hint {
  position: absolute;
  right: 16px;
  top: 56px;
  font-size: 12px;
  color: var(--sub);
  background: var(--chip-bg);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  pointer-events: none;
  backdrop-filter: blur(4px);
}

.mode-toggle {
  position: absolute;
  right: 16px;
  top: 12px;
  display: inline-flex;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--chip-bg);
  overflow: hidden;
  backdrop-filter: blur(4px);
  z-index: 4;
}

.mode-btn {
  padding: 4px 13px;
  font-size: 12px;
  font-family: inherit;
  border: none;
  background: transparent;
  color: var(--sub);
  cursor: pointer;
  transition: all 0.18s;
}

.mode-btn.on {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent-strong);
  font-weight: 600;
}

.mode-btn:not(.on):hover {
  color: var(--text);
}

.back-btn {
  position: absolute;
  right: 16px;
  top: 56px;
  font-size: 13px;
  color: var(--text);
  background: var(--chip-bg);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(4px);
}

.back-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------- 晕渲地形层 ---------- */

.terrain-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
  z-index: 0;
}

.terrain-layer.visible {
  opacity: 1;
}
</style>
