<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { state, MIN_YEAR, MAX_YEAR, resetFilters } from '@/state'
import { DATA_META, SPOTS_5A } from '@/data'
import { visited } from '@/lib/visited'
import { locateSpot } from '@/lib/navigation'
import { allSpots, ensure4ALoaded, loading4a, error4a } from '@/lib/spots4a'
import { theme, toggleTheme } from '@/lib/theme'
import { categoryStyle } from '@/lib/icons'
import { searchSpots } from '@/lib/search'
import type { Spot } from '@/types'

/* ---------------- 搜索（支持键盘导航 / 空态提示） ---------------- */

watch(
  () => [state.levels['4A'], state.query.trim()] as const,
  ([enabled, query]) => {
    if (enabled || query) void ensure4ALoaded()
  },
  { immediate: true },
)

const searchFocused = ref(false)
function onSearchFocusOut(event: FocusEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    searchFocused.value = false
}
const activeIndex = ref(-1)
const searchResults = computed(() => searchSpots(allSpots.value, state.query))

watch(searchResults, () => {
  activeIndex.value = -1
})

function jumpToSpot(spot: Spot): void {
  locateSpot(spot)
  state.selectedSpot = spot
  state.query = ''
  activeIndex.value = -1
  searchFocused.value = false
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!searchResults.value.length) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    activeIndex.value =
      activeIndex.value < 0
        ? delta === 1
          ? 0
          : searchResults.value.length - 1
        : (activeIndex.value + delta + searchResults.value.length) % searchResults.value.length
    void nextTick(() =>
      document
        .getElementById(`search-option-${activeIndex.value}`)
        ?.scrollIntoView({ block: 'nearest' }),
    )
  } else if (e.key === 'Enter') {
    const target =
      activeIndex.value >= 0 ? searchResults.value[activeIndex.value] : searchResults.value[0]
    if (target) {
      e.preventDefault()
      jumpToSpot(target)
    }
  } else if (e.key === 'Escape') {
    // 输入框内 Esc 优先清空搜索（阻止冒泡到全局的返回上一级处理）
    e.stopPropagation()
    if (state.query) {
      state.query = ''
      activeIndex.value = -1
    }
  }
}

/* ---------------- 年份演进动画 ---------------- */

let playTimer: ReturnType<typeof setInterval> | null = null

function togglePlay(): void {
  state.playing = !state.playing
}

watch(
  () => state.playing,
  (playing) => {
    if (playTimer) {
      clearInterval(playTimer)
      playTimer = null
    }
    if (!playing) return
    if (state.yearMax >= MAX_YEAR) state.yearMax = MIN_YEAR
    playTimer = setInterval(() => {
      if (state.yearMax >= MAX_YEAR) {
        state.playing = false
        return
      }
      state.yearMax += 1
    }, 260)
  },
)

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
})

/* ---------------- 面包屑 ---------------- */

function backToNational(): void {
  state.view = { mode: 'national' }
}

/* ---------------- 随机探索 & 打卡 ---------------- */

const visitedTotal = computed(() => visited.names.size)

function randomExplore(): void {
  if (!SPOTS_5A.length) return
  const pick = SPOTS_5A[Math.floor(Math.random() * SPOTS_5A.length)]
  jumpToSpot(pick)
}

const yearPercent = computed(() => ((state.yearMax - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100)
</script>

<template>
  <header class="topbar">
    <div class="row main-row">
      <div class="brand">
        <div class="logo" aria-hidden="true"></div>
        <div class="titles">
          <h1 class="title">中国 A 级景区地图</h1>
          <p class="subtitle">
            {{ DATA_META.spotCount5A }} 家 5A · {{ DATA_META.spotCount4A }} 家 4A · 数据截至
            {{ DATA_META.generatedAt.slice(0, 10) }} · 📍 已打卡 {{ visitedTotal }}
          </p>
        </div>
      </div>

      <div
        class="search"
        :class="{ focused: searchFocused || searchResults.length }"
        @focusout="onSearchFocusOut"
      >
        <span class="search-icon">⌕</span>
        <input
          v-model="state.query"
          type="text"
          placeholder="搜索景区 / 城市…"
          title="按 / 快速搜索，↑↓ 选择，Enter 打开，Esc 清空"
          role="combobox"
          aria-label="搜索景区或城市"
          aria-autocomplete="list"
          :aria-expanded="searchFocused && Boolean(state.query)"
          aria-controls="search-results"
          :aria-activedescendant="activeIndex >= 0 ? `search-option-${activeIndex}` : undefined"
          @focus="searchFocused = true"
          @keydown="onSearchKeydown"
        />
        <button
          v-if="state.query"
          aria-label="清空搜索"
          class="search-clear"
          @click="state.query = ''"
        >
          ✕
        </button>
        <Transition name="dropdown">
          <ul
            v-if="state.query && searchFocused"
            id="search-results"
            class="search-results"
            role="listbox"
            aria-label="景区搜索结果"
          >
            <li v-if="loading4a" class="search-empty" role="status">正在搜索 4A 数据…</li>
            <li v-if="error4a" class="search-empty">
              <button @click="ensure4ALoaded">{{ error4a }}</button>
            </li>
            <li v-if="!searchResults.length && !loading4a && !error4a" class="search-empty">
              未找到「{{ state.query }}」相关景区
            </li>
            <li
              v-for="(s, i) in searchResults"
              :id="`search-option-${i}`"
              :key="s.name"
              role="option"
              :aria-selected="i === activeIndex"
            >
              <button
                tabindex="-1"
                :class="{ active: i === activeIndex }"
                @mousedown.prevent
                @click="jumpToSpot(s)"
                @mousemove="activeIndex = i"
              >
                <span class="level-badge" :class="s.level === '5A' ? 'l5' : 'l4'">{{
                  s.level
                }}</span>
                <span class="name">{{ s.name }}</span>
                <span class="loc"
                  >{{ s.province }}{{ s.city && s.city !== s.province ? ` · ${s.city}` : '' }}</span
                >
              </button>
            </li>
          </ul>
        </Transition>
      </div>

      <div class="quick-actions">
        <button class="theme-toggle" title="随机探索一家 5A 景区" @click="randomExplore">🎲</button>
        <button
          class="theme-toggle"
          :title="theme.mode === 'light' ? '切换到深色' : '切换到浅色'"
          @click="toggleTheme"
        >
          {{ theme.mode === 'light' ? '🌙' : '☀️' }}
        </button>
      </div>
    </div>

    <div class="row toolbar">
      <nav class="breadcrumb" aria-label="当前位置">
        <button :class="{ active: state.view.mode === 'national' }" @click="backToNational()">
          全国
        </button>
        <template v-if="state.view.mode === 'province'">
          <span class="sep">/</span>
          <button class="active province" @click="backToNational()">
            {{ state.view.full }}
            <span class="close" title="返回全国">✕</span>
          </button>
        </template>
      </nav>

      <div class="level-filter">
        <button
          class="chip l5"
          :class="{ off: !state.levels['5A'] }"
          :aria-pressed="state.levels['5A']"
          @click="state.levels['5A'] = !state.levels['5A']"
        >
          5A · {{ DATA_META.spotCount5A }}
        </button>
        <button
          class="chip l4"
          :class="{ off: !state.levels['4A'] }"
          :aria-pressed="state.levels['4A']"
          @click="state.levels['4A'] = !state.levels['4A']"
        >
          4A 收录 · {{ DATA_META.spotCount4A }}
        </button>
        <button v-if="state.category" class="chip cat" @click="state.category = null">
          {{ categoryStyle(state.category).icon }} {{ state.category }} ✕
        </button>
      </div>

      <span v-if="loading4a" role="status">正在加载 4A…</span>
      <button v-else-if="error4a" class="chip" @click="ensure4ALoaded">
        {{ error4a }}
      </button>

      <div class="year-filter">
        <button class="play" :title="state.playing ? '暂停' : '播放年份演进'" @click="togglePlay">
          {{ state.playing ? '❙❙' : '▶' }}
        </button>
        <div class="slider-wrap">
          <div class="slider-track">
            <div class="slider-progress" :style="{ width: yearPercent + '%' }" />
          </div>
          <input
            v-model.number="state.yearMax"
            type="range"
            :min="MIN_YEAR"
            :max="MAX_YEAR"
            step="1"
            aria-label="记录年份上限"
            @input="state.playing = false"
          />
        </div>
        <span class="year-value">{{ state.yearMax }}</span>
      </div>
    </div>
    <div class="filter-help">
      <span>记录年份 ≤ {{ state.yearMax }} · 5A 评定 / 4A 收录</span>
      <label><input v-model="state.includeUnknownYear" type="checkbox" /> 包含年份未知</label>
      <button class="utility-button reset-filters" @click="resetFilters">重置筛选</button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 18px;
}

.main-row {
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}

.logo {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 13px;
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.9), transparent 42%),
    linear-gradient(150deg, var(--accent), var(--accent-strong));
  box-shadow: var(--shadow-sm);
  position: relative;
}

.logo::after {
  content: '';
  position: absolute;
  inset: 8px 10px 14px;
  border-radius: 50% 50% 50% 0;
  border-bottom: 2.5px solid rgba(255, 255, 255, 0.85);
  transform: rotate(-18deg);
}

.title {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: 0.02em;
  background: linear-gradient(
    92deg,
    var(--text) 30%,
    color-mix(in srgb, var(--accent) 60%, var(--text))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: nowrap;
}

.subtitle {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--sub);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- 搜索 ---------- */

.search {
  position: relative;
  width: min(320px, 32vw);
}

.search input {
  width: 100%;
  padding: 9px 34px 9px 34px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--panel-solid);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.search input::placeholder {
  color: color-mix(in srgb, var(--sub) 80%, transparent);
}

.search.focused input {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sub);
  font-size: 15px;
  pointer-events: none;
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--sub);
  cursor: pointer;
  padding: 4px;
}

.search-clear:hover {
  color: var(--text);
}

.search-results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  list-style: none;
  margin: 0;
  padding: 6px;
  background: var(--panel-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  max-height: 320px;
  overflow-y: auto;
}

.search-results button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.search-results button:hover,
.search-results button.active {
  background: var(--accent-soft);
}

.search-empty {
  padding: 14px 10px;
  font-size: 12.5px;
  color: var(--sub);
  text-align: center;
}

.dropdown-enter-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.dropdown-leave-active {
  transition: opacity 0.12s ease;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.dropdown-leave-to {
  opacity: 0;
}

.search-results .name {
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-results .loc {
  font-size: 11px;
  color: var(--sub);
  flex: none;
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

/* ---------- 主题切换 ---------- */

.theme-toggle {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel-solid);
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s;
}

.theme-toggle:hover {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-soft);
  transform: rotate(12deg);
}

/* ---------- 工具栏 ---------- */

.toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb button {
  padding: 5px 14px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--chip-bg);
  color: var(--sub);
  cursor: pointer;
  transition: all 0.2s;
}

.breadcrumb button.active {
  color: var(--text);
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--accent) 8%, var(--panel-solid));
}

.breadcrumb button.province {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb .close {
  font-size: 10px;
  opacity: 0.6;
}

.breadcrumb .sep {
  color: var(--sub);
  font-size: 12px;
}

.level-filter {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  padding: 5px 13px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 999px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.chip.l5 {
  color: #fff;
  background: linear-gradient(120deg, #f0ad2e, #e08c06);
}

.chip.l5:hover {
  box-shadow: 0 4px 14px rgba(224, 140, 6, 0.35);
}

.chip.l4 {
  color: #fff;
  background: linear-gradient(120deg, #14b8a6, #0d9488);
}

.chip.l4:hover {
  box-shadow: 0 4px 14px rgba(13, 148, 136, 0.35);
}

.chip.off {
  background: var(--panel-solid);
  color: var(--sub);
  border-color: var(--border);
}

.chip.cat {
  color: var(--text);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

/* ---------- 年份滑块 ---------- */

.year-filter {
  display: flex;
  align-items: center;
  gap: 10px;
}

.play {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel-solid);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s;
}

.play:hover {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-soft);
}

.slider-wrap {
  position: relative;
  width: 170px;
  height: 22px;
  display: flex;
  align-items: center;
}

.slider-wrap input[type='range'] {
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
  z-index: 2;
}

.slider-wrap input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--panel-solid);
  box-shadow: 0 0 8px var(--accent-soft);
}

.slider-wrap input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--panel-solid);
}

.slider-track {
  position: absolute;
  left: 7px;
  right: 7px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--sub) 25%, transparent);
}

.slider-progress {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, #4d86c2), var(--accent));
  transition: width 0.2s;
}

.year-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-strong);
  width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.quick-actions {
  display: flex;
  gap: 8px;
}
.filter-help {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  color: var(--sub);
  font-size: 12px;
}
.filter-help label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
@media (max-width: 900px) {
  .main-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
  }
  .search {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
  }
  .subtitle {
    white-space: normal;
    line-height: 1.5;
  }
  .title {
    font-size: 17px;
    white-space: normal;
  }
  .logo {
    display: none;
  }
  .theme-toggle {
    width: 40px;
    height: 40px;
  }
  .year-filter {
    flex: 1;
  }
  .slider-wrap {
    flex: 1;
    min-width: 100px;
  }
  .search input {
    font-size: 16px;
  }
  .search-results button {
    min-height: 44px;
  }
  .search-results .loc {
    max-width: 85px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
