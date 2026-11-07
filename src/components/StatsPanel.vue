<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { visibleSpots, currentSpots, categoryBaseSpots, UNKNOWN_CATEGORY } from '@/lib/filter'
import ExploreTools from '@/components/ExploreTools.vue'
import { CATEGORIES } from '@/data'
import { categoryStyle } from '@/lib/icons'
import { PROVINCES } from '@/data/provinces'
import { prefetchProvinceMap } from '@/composables/geo'
import { state, resetFilters } from '@/state'
import type { Spot } from '@/types'

const count5a = computed(() => currentSpots.value.filter((s) => s.level === '5A').length)
const count4a = computed(() => currentSpots.value.filter((s) => s.level === '4A').length)

/* KPI 数字滚动动画（尊重减少动态效果偏好） */
function useCountUp(source: Ref<number>): Ref<number> {
  const display = ref(source.value)
  let raf = 0
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  watch(source, (to) => {
    const from = display.value
    cancelAnimationFrame(raf)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      display.value = to
      return
    }
    const t0 = performance.now()
    const dur = 380
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      display.value = Math.round(from + (to - from) * e)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })
  return display
}

const displayTotal = useCountUp(computed(() => currentSpots.value.length))
const display5a = useCountUp(count5a)
const display4a = useCountUp(count4a)

/** 全国省级行政区排行（全国视图） */
const topProvinces = computed(() => {
  const counts = new Map<string, number>()
  for (const p of PROVINCES) counts.set(p.short, 0)
  for (const s of visibleSpots.value) {
    counts.set(s.province, (counts.get(s.province) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
})

/** 聚焦视图：本区域景区列表（按地级市分组） */
const provinceGroups = computed(() => {
  const view = state.view
  if (view.mode !== 'province') return []
  const groups = new Map<string, Spot[]>()
  for (const s of visibleSpots.value) {
    if (s.province !== view.short) continue
    const key = s.city || view.short
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }
  return [...groups.entries()]
    .map(([city, spots]) => ({
      city,
      spots: spots.sort((a, b) => b.level.localeCompare(a.level) || (b.year ?? 0) - (a.year ?? 0)),
    }))
    .sort((a, b) => b.spots.length - a.spots.length)
})

/** 类别分布 */
const categoryStats = computed(() =>
  [...CATEGORIES, UNKNOWN_CATEGORY]
    .map((c) => ({
      name: c,
      value: categoryBaseSpots.value.filter(
        (s) =>
          (state.view.mode === 'national' || s.province === state.view.short) &&
          (s.category || UNKNOWN_CATEGORY) === c,
      ).length,
    }))
    .sort((a, b) => b.value - a.value),
)

const maxProvinceCount = computed(() => Math.max(1, topProvinces.value[0]?.value ?? 1))
const maxCategoryCount = computed(() => Math.max(1, categoryStats.value[0]?.value ?? 1))
const provinceSpotTotal = computed(() =>
  provinceGroups.value.reduce((n, g) => n + g.spots.length, 0),
)

function drill(provinceShort: string): void {
  const p = PROVINCES.find((x) => x.short === provinceShort)
  if (!p || p.adcode === 710000) return
  state.view = { mode: 'province', adcode: p.adcode, short: p.short, full: p.full, kind: p.kind }
}

function prefetchProvince(provinceShort: string): void {
  const p = PROVINCES.find((x) => x.short === provinceShort)
  if (p && p.adcode !== 710000) prefetchProvinceMap(p.adcode)
}

function openSpot(spot: Spot): void {
  state.selectedSpot = spot
}

function toggleCategory(name: string): void {
  state.category = state.category === name ? null : name
}
</script>

<template>
  <aside class="stats-panel">
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-value">{{ displayTotal }}</div>
        <div class="kpi-label">当前展示</div>
      </div>
      <div class="kpi gold">
        <div class="kpi-value">{{ display5a }}</div>
        <div class="kpi-label">5A 景区</div>
      </div>
      <div class="kpi cyan">
        <div class="kpi-value">{{ display4a }}</div>
        <div class="kpi-label">4A 景区</div>
      </div>
    </div>

    <ExploreTools />
    <div v-if="!currentSpots.length" class="card empty" role="status">
      当前条件下没有景区，请调整等级、年份或类别。
      <button class="utility-button" @click="resetFilters">恢复默认筛选</button>
    </div>
    <p v-if="currentSpots.some((s) => s.year == null)" class="data-note">
      当前包含
      {{ currentSpots.filter((s) => s.year == null).length }}
      家年份未知景区，不代表其在所选年份已获评。
    </p>
    <section class="card">
      <h3 class="card-title">
        全国省级行政区排行
        <span class="card-sub">{{ state.view.mode === 'national' ? '点击进入' : '点击切换' }}</span>
      </h3>
      <ul class="bar-list">
        <li v-for="p in topProvinces.slice(0, 10)" :key="p.name">
          <button
            class="bar-row"
            :title="p.name"
            @mouseenter="prefetchProvince(p.name)"
            @focus="prefetchProvince(p.name)"
            @click="drill(p.name)"
          >
            <span class="bar-name">{{ p.name }}</span>
            <span class="bar-track">
              <span class="bar-fill" :style="{ width: (p.value / maxProvinceCount) * 100 + '%' }" />
            </span>
            <span class="bar-value">{{ p.value }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="state.view.mode === 'province'" class="card">
      <h3 class="card-title">
        {{ state.view.short }} · 景区列表
        <span class="card-sub">{{ provinceSpotTotal }} 家 · 按地级行政区分组</span>
      </h3>
      <div class="spot-groups">
        <section v-for="g in provinceGroups" :key="g.city" class="spot-group">
          <h4 class="group-title">
            {{ g.city }}<span class="group-count">{{ g.spots.length }}</span>
          </h4>
          <ul class="spot-list">
            <li v-for="s in g.spots" :key="s.name">
              <button class="spot-row" @click="openSpot(s)">
                <span class="level-badge" :class="s.level === '5A' ? 'l5' : 'l4'">{{
                  s.level
                }}</span>
                <span class="spot-name" :title="s.name">{{ s.name }}</span>
                <span class="spot-year">{{ s.year ?? '' }}</span>
              </button>
            </li>
          </ul>
        </section>
        <p v-if="!provinceSpotTotal" class="empty">当前筛选条件下没有景区</p>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">类别分布 <span class="card-sub">筛选前数量 · 点击切换</span></h3>
      <ul class="bar-list">
        <li v-for="c in categoryStats" :key="c.name">
          <button
            class="bar-row"
            :class="{ active: state.category === c.name }"
            :aria-pressed="state.category === c.name"
            :title="c.name"
            @click="toggleCategory(c.name)"
          >
            <span class="bar-name">{{ categoryStyle(c.name).icon }}{{ c.name }}</span>
            <span class="bar-track cat">
              <span
                class="bar-fill cat"
                :style="{ width: (c.value / maxCategoryCount) * 100 + '%' }"
              />
            </span>
            <span class="bar-value">{{ c.value }}</span>
          </button>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow-y: auto;
  padding-right: 2px;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.kpi {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 13px 8px;
  text-align: center;
  backdrop-filter: blur(8px);
  transition: border-color 0.3s;
}

.kpi-value {
  font-size: 25px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.kpi.gold .kpi-value {
  color: var(--gold);
}

.kpi.cyan .kpi-value {
  color: var(--accent);
}

.kpi-label {
  margin-top: 3px;
  font-size: 11px;
  color: var(--sub);
}

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 14px 12px;
  backdrop-filter: blur(8px);
  transition: border-color 0.3s;
}

.card-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.card-sub {
  font-weight: 400;
  font-size: 11px;
  color: var(--sub);
  margin-left: 6px;
}

.bar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(52px, auto) 1fr 30px;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}

.bar-row:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.bar-row.active {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.bar-name {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 118px;
}

.bar-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--sub) 18%, transparent);
  overflow: hidden;
}

.bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 35%, #4d86c2),
    color-mix(in srgb, var(--accent) 85%, #4d86c2)
  );
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.bar-fill.cat {
  background: linear-gradient(90deg, #d9a13c, #e08c06);
}

.bar-value {
  font-size: 12px;
  color: var(--sub);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ---------- 聚焦视图分组列表 ---------- */

.spot-groups {
  max-height: 52vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--sub);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 6px;
}

.group-count {
  font-size: 10px;
  color: var(--sub);
  background: color-mix(in srgb, var(--sub) 14%, transparent);
  border-radius: 999px;
  padding: 0 7px;
  font-variant-numeric: tabular-nums;
}

.spot-list {
  list-style: none;
  margin: 5px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.spot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}

.spot-row:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.level-badge {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  color: #fff;
}

.level-badge.l5 {
  background: #ea9c0f;
}

.level-badge.l4 {
  background: #0d9488;
}

.spot-name {
  flex: 1;
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spot-year {
  font-size: 11px;
  color: var(--sub);
  font-variant-numeric: tabular-nums;
  flex: none;
  width: 30px;
  text-align: right;
}

.empty {
  padding: 14px 6px;
  font-size: 12px;
  color: var(--sub);
  text-align: center;
}

/* 窄屏：由侧栏统一滚动，避免双层滚动嵌套 */
@media (max-width: 900px) {
  .spot-groups {
    max-height: none;
  }
}
</style>
