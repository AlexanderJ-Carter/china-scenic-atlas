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
    e.stopPropagation()
    if (state.query) {
      state.query = ''
      activeIndex.value = -1
    }
  }
}

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

function backToNational(): void {
  state.view = { mode: 'national' }
}

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
    <div class="hero-row">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
            <path
              d="M6.5 21.5 Q16 4.5 25.5 21.5"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
            <circle cx="16" cy="13.5" r="2.6" fill="var(--gold)" />
          </svg>
        </div>
        <div class="titles">
          <h1 class="title">中国 A 级景区地图</h1>
          <p class="subtitle">
            {{ DATA_META.spotCount5A }} 家 5A · {{ DATA_META.spotCount4A }} 家 4A · 截至
            {{ DATA_META.generatedAt.slice(0, 10) }} · 已打卡 {{ visitedTotal }}
          </p>
        </div>
      </div>

      <div
        class="search"
        :class="{ focused: searchFocused || searchResults.length }"
        @focusout="onSearchFocusOut"
      >
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6" />
            <path d="M13 13l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </span>
        <input
          v-model="state.query"
          type="text"
          placeholder="搜索景区 / 城市…  /"
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
        <button class="icon-btn" title="随机探索一家 5A 景区" @click="randomExplore">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M3.5 4.5h4l2.5 3.5L13 4.5h3.5M3.5 15.5h4l2.5-3.5 2.5 3.5h3.5M16.5 4.5v11"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          class="icon-btn"
          :title="theme.mode === 'light' ? '切换到深色' : '切换到浅色'"
          @click="toggleTheme"
        >
          <svg
            v-if="theme.mode === 'light'"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M15.5 11.2A6.5 6.5 0 0 1 8.8 4.5 6.6 6.6 0 1 0 15.5 11.2Z"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
          <svg v-else viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="3.2" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="toolbar surface">
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
          4A · {{ DATA_META.spotCount4A }}
        </button>
        <button v-if="state.category" class="chip cat" @click="state.category = null">
          {{ categoryStyle(state.category).icon }} {{ state.category }} ✕
        </button>
      </div>

      <span v-if="loading4a" role="status" class="status">正在加载 4A…</span>
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

.hero-row {
  display: flex;
  align-items: center;
  gap: 18px;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.logo {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 12px;
  background: var(--ink);
  color: var(--accent);
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-sm);
}

.title {
  margin: 0;
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  color: var(--text);
  white-space: nowrap;
}

.subtitle {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--sub);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.search {
  position: relative;
  width: min(360px, 34vw);
}

.search input {
  width: 100%;
  padding: 10px 36px 10px 40px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel-solid);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.search input::placeholder {
  color: color-mix(in srgb, var(--sub) 80%, transparent);
}

.search.focused input {
  border-color: color-mix(in srgb, var(--info) 55%, var(--border));
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--info) 14%, transparent),
    var(--shadow-sm);
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sub);
  display: grid;
  place-items: center;
  pointer-events: none;
}

.search-clear {
  position: absolute;
  right: 10px;
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
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 30;
  list-style: none;
  margin: 0;
  padding: 8px;
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
  padding: 8px 10px;
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
  background: #c58600;
}

.level-badge.l4 {
  background: #08a3a3;
}

[data-theme='dark'] .level-badge.l5 {
  background: #fbce03;
  color: #15110c;
}

[data-theme='dark'] .level-badge.l4 {
  background: #40dccd;
  color: #15110c;
}

.icon-btn {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel-solid);
  color: var(--text);
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.2s,
    transform 0.2s,
    background 0.2s;
}

.icon-btn:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--ink) 4%, var(--panel-solid));
  transform: translateY(-1px);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 10px 12px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb button {
  padding: 6px 14px;
  font-size: 13px;
  font-family: inherit;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--sub);
  cursor: pointer;
  transition: all 0.2s;
}

.breadcrumb button.active {
  color: var(--ink-on);
  border-color: transparent;
  background: var(--ink);
}

.breadcrumb button.province {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb .close {
  font-size: 10px;
  opacity: 0.7;
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
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 650;
  font-family: inherit;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.chip.l5 {
  color: #fff;
  background: linear-gradient(120deg, #e2a400, #c58600);
}

.chip.l5:hover {
  box-shadow: 0 4px 14px rgba(197, 134, 0, 0.28);
}

.chip.l4 {
  color: #fff;
  background: linear-gradient(120deg, #0db7af, #08767d);
}

.chip.l4:hover {
  box-shadow: 0 4px 14px rgba(8, 163, 163, 0.28);
}

.chip.off {
  background: transparent;
  color: var(--sub);
  border-color: var(--border);
  box-shadow: none;
}

.chip.cat {
  color: var(--text);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

.status {
  font-size: 12px;
  color: var(--sub);
}

.year-filter {
  display: flex;
  align-items: center;
  gap: 10px;
}

.play {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--radius-pill);
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
  background: var(--ink);
  border: 2px solid var(--panel-solid);
  box-shadow: var(--shadow-sm);
}

.slider-wrap input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ink);
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
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--info) 55%, var(--accent)),
    var(--accent)
  );
  transition: width 0.2s;
}

.year-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
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
  padding: 0 4px;
}

.filter-help label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

@media (max-width: 900px) {
  .hero-row {
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
    font-size: 18px;
    white-space: normal;
  }
  .logo {
    display: none;
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
