<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { state } from '@/state'
import { allSpots } from '@/lib/spots4a'
import { locateSpot } from '@/lib/navigation'
import { PROVINCES } from '@/data/provinces'
import { categoryStyle } from '@/lib/icons'
import { fetchWikiSummary, type WikiSummary } from '@/lib/wiki'
import { getOfficialInfo, type OfficialInfo } from '@/lib/officialInfo'
import { isVisited, toggleVisited, visited } from '@/lib/visited'
import type { Spot } from '@/types'

const drawer = ref<HTMLElement>()
watch(
  () => Boolean(state.selectedSpot),
  async (open, _old, onCleanup) => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const background = document.querySelector<HTMLElement>('.app')
    const overflow = document.body.style.overflow
    const wasInert = background?.inert ?? false
    let active = true
    document.body.style.overflow = 'hidden'
    if (background) background.inert = true
    onCleanup(() => {
      active = false
      document.body.style.overflow = overflow
      if (background) background.inert = wasInert
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    })
    await nextTick()
    if (active)
      drawer.value?.querySelector<HTMLButtonElement>('.close-btn')?.focus({ preventScroll: true })
  },
  { flush: 'post' },
)

function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const items = [
    ...(drawer.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], summary, [tabindex="0"]',
    ) ?? []),
  ].filter((el) => el.getClientRects().length > 0)
  const first = items[0],
    last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

const spot = computed(() => state.selectedSpot)
const wiki = ref<WikiSummary | null>(null)
const wikiLoading = ref(false)
const imgError = ref(false)
const imgLoaded = ref(false)
const official = ref<OfficialInfo | null>(null)

// 打开抽屉时异步加载维基摘要（图片/简介）与官网/开放时间，失败静默降级
watch(
  spot,
  async (s, _previous, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    wiki.value = null
    official.value = null
    imgError.value = false
    imgLoaded.value = false
    wikiLoading.value = false
    if (!s) return
    wikiLoading.value = true
    try {
      const [w, o] = await Promise.all([fetchWikiSummary(s.name), getOfficialInfo(s.name)])
      if (!current) return
      wiki.value = w
      official.value = o
    } finally {
      if (current) wikiLoading.value = false
    }
  },
  { immediate: true },
)

const art = computed(() => categoryStyle(spot.value?.category))
const showImage = computed(() => wiki.value?.thumb && !imgError.value)
const desc = computed(() => spot.value?.desc || wiki.value?.extract)
const been = computed(() => (spot.value ? isVisited(spot.value.name) : false))

const related = computed<Spot[]>(() => {
  const s = spot.value
  if (!s) return []
  // 同省优先同城 5A，再补同省其他景区
  const sameProv = allSpots.value.filter((x) => x.province === s.province && x.name !== s.name)
  const sameCity = sameProv.filter((x) => x.city === s.city)
  const rest = sameProv.filter((x) => x.city !== s.city)
  const ranked = [
    ...sameCity.filter((x) => x.level === '5A'),
    ...sameCity.filter((x) => x.level !== '5A'),
    ...rest.filter((x) => x.level === '5A'),
    ...rest.filter((x) => x.level !== '5A'),
  ]
  return ranked.slice(0, 8)
})

const hasPractical = computed(
  () =>
    Boolean(official.value?.hours || official.value?.ticketHint || official.value?.website) ||
    spot.value?.level === '5A',
)

function onToggleVisited(): void {
  if (spot.value) toggleVisited(spot.value.name)
}

// 供模板直接使用（触发响应式更新）
const visitedSet = visited

function close(): void {
  state.selectedSpot = null
}

function goToProvince(): void {
  if (!spot.value) return
  locateSpot(spot.value)
  close()
}

function switchSpot(s: Spot): void {
  locateSpot(s)
  state.selectedSpot = s
  drawer.value?.scrollTo({ top: 0 })
  void nextTick(() =>
    drawer.value?.querySelector<HTMLButtonElement>('.close-btn')?.focus({ preventScroll: true }),
  )
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer" :duration="{ enter: 280, leave: 180 }">
      <div v-if="spot" class="drawer-root">
        <div class="backdrop" @click="close"></div>
        <aside
          ref="drawer"
          class="drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="spot-title"
          @keydown="trapFocus"
        >
          <button class="close-btn" title="关闭 (Esc)" @click="close">✕</button>

          <div :key="spot.name" class="detail-content">
            <!-- 封面：维基/Commons 代表图，无图时用分类插画 -->
            <div class="cover">
              <div class="art" :class="art.cls" aria-hidden="true">
                <span>{{ art.icon }}</span>
              </div>
              <img
                v-if="showImage"
                :key="spot.name"
                :src="wiki!.thumb"
                :alt="spot.name"
                loading="lazy"
                decoding="async"
                :class="{ ready: imgLoaded }"
                @load="imgLoaded = true"
                @error="imgError = true"
              />
              <div class="cover-shade"></div>
              <div class="cover-text">
                <span class="level-badge" :class="spot.level === '5A' ? 'l5' : 'l4'">
                  {{ spot.official ? '国家' : '参考' }}{{ spot.level }}级
                </span>
                <span v-if="!spot.official" class="unofficial">非官方评定 · 供参考</span>
              </div>
            </div>

            <div class="body">
              <header class="title-block">
                <h2 id="spot-title" class="spot-name">{{ spot.name }}</h2>
                <div class="meta-chips">
                  <span class="chip loc"
                    >{{ spot.province
                    }}{{ spot.city && spot.city !== spot.province ? ` · ${spot.city}` : '' }}</span
                  >
                  <span class="chip">
                    {{
                      spot.year
                        ? `${spot.year} 年${spot.level === '5A' ? '评定' : '收录'}`
                        : '年份未知'
                    }}
                  </span>
                  <span v-if="spot.category" class="chip">{{ art.icon }} {{ spot.category }}</span>
                </div>
              </header>

              <p v-if="wikiLoading && !desc" class="data-note" role="status">正在加载景区介绍…</p>
              <p v-else-if="!desc" class="data-note">暂无景区介绍，可查看下方数据来源。</p>
              <p v-if="desc" class="desc">{{ desc }}</p>
              <p v-if="spot.note" class="note">※ {{ spot.note }}</p>

              <!-- 实用信息：5A 始终展示卡片，缺项诚实标注 -->
              <section v-if="hasPractical" class="practical" aria-label="游玩信息">
                <h3 class="practical-title">游玩信息</h3>
                <div class="p-row">
                  <span class="p-label">开放时间</span>
                  <span :class="{ missing: !official?.hours }">{{
                    official?.hours || '暂无收录，出发前请以景区公示为准'
                  }}</span>
                </div>
                <div class="p-row">
                  <span class="p-label">门票</span>
                  <span :class="{ missing: !official?.ticketHint }">{{
                    official?.ticketHint || '暂无收录，价格以官方渠道为准'
                  }}</span>
                </div>
                <div class="p-row site-row">
                  <span class="p-label">官网</span>
                  <a
                    v-if="official?.website"
                    class="official-link"
                    :href="official.website"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开官方网站 ↗
                  </a>
                  <span v-else class="missing">暂无收录可靠官网链接</span>
                </div>
              </section>

              <div class="visit-row">
                <button class="visit-btn" :class="{ been }" @click="onToggleVisited">
                  {{ been ? '✓ 我去过 · 点击取消' : '标记我去过' }}
                </button>
                <span class="visit-sub">已打卡 {{ visitedSet.names.size }} 家</span>
              </div>

              <button class="action" @click="goToProvince">
                切换到所在{{
                  PROVINCES.find((p) => p.short === spot?.province)?.kind ?? '区域'
                }}地图 →
              </button>

              <section v-if="related.length" class="related">
                <h3>{{ spot.province }}的其他景区</h3>
                <div class="related-grid">
                  <button
                    v-for="r in related"
                    :key="r.name"
                    class="related-card"
                    @click="switchSpot(r)"
                  >
                    <span class="level-badge" :class="r.level === '5A' ? 'l5' : 'l4'">{{
                      r.level
                    }}</span>
                    <span class="r-meta">
                      <span class="r-name">{{ r.name }}</span>
                      <span class="r-city"
                        >{{ r.city }}{{ r.category ? ` · ${r.category}` : '' }}</span
                      >
                    </span>
                  </button>
                </div>
              </section>

              <!-- 数据与来源：折叠收纳，不喧宾夺主 -->
              <details v-if="spot.coordSource || spot.lng" class="source-block">
                <summary>ⓘ 数据与来源</summary>
                <div class="source-body">
                  <div class="source-row">
                    <span class="source-label">数据口径</span>
                    <span>{{
                      spot.level === '5A'
                        ? '文旅部公告 + 维基百科核对'
                        : '维基百科 4A 分类（精选条目经对抗核查）'
                    }}</span>
                  </div>
                  <div class="source-row">
                    <span class="source-label">坐标</span>
                    <span class="coords"
                      >{{ spot.lng.toFixed(2) }}°E, {{ spot.lat.toFixed(2) }}°N（GCJ-02）</span
                    >
                  </div>
                  <div v-if="spot.coordSource" class="source-row">
                    <span class="source-label">坐标来源</span>
                    <span>{{ spot.coordSource }}</span>
                  </div>
                  <a
                    v-if="wiki?.url"
                    class="wiki-link"
                    :href="wiki.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    维基百科词条 ↗
                  </a>
                  <div v-if="wikiLoading" class="source-row dim">正在加载本地简介库…</div>
                  <div v-else-if="!wiki" class="source-row dim">未找到维基百科词条</div>
                </div>
              </details>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(430px, 94vw);
  background: var(--panel-solid);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 5;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(10, 20, 36, 0.45);
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(4px);
}

.close-btn:hover {
  background: rgba(10, 20, 36, 0.7);
}

/* ---------- 封面 ---------- */

.cover {
  position: relative;
  aspect-ratio: 16 / 9;
  flex: none;
  overflow: hidden;
  background: #16233a;
}

.cover img {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 180ms ease;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover img.ready {
  opacity: 1;
}

.cover .art {
  width: 100%;
  height: 100%;
  font-size: 52px;
}

.cover-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 30%, rgba(0, 0, 0, 0.62) 100%);
}

.cover-text {
  position: absolute;
  left: 16px;
  bottom: 12px;
  right: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.level-badge {
  font-size: 11.5px;
  font-weight: 700;
  padding: 3px 11px;
  border-radius: 999px;
  color: #fff;
}

.level-badge.l5 {
  background: linear-gradient(120deg, #f0ad2e, #e08c06);
}

.level-badge.l4 {
  background: linear-gradient(120deg, #14b8a6, #0d9488);
}

.unofficial {
  font-size: 11px;
  color: #ffe9b0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

/* ---------- 内容 ---------- */

.body {
  padding: 20px 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.spot-name {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.32;
  color: var(--text);
  letter-spacing: -0.01em;
}

.meta-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip {
  font-size: 12px;
  color: var(--sub);
  background: color-mix(in srgb, var(--sub) 10%, transparent);
  border: 1px solid var(--border);
  padding: 4px 11px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.chip.loc {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
}

.desc {
  font-size: 14px;
  line-height: 1.85;
  color: color-mix(in srgb, var(--text) 85%, var(--sub));
  margin: 0;
}

.data-note {
  margin: 0;
  font-size: 13px;
  color: var(--sub);
}

/* ---------- 实用信息 & 打卡 ---------- */

.practical {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: var(--radius-md);
  padding: 14px 16px;
}

.practical-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-strong);
}

.p-row {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.55;
}

.p-label {
  color: var(--sub);
  font-size: 12.5px;
  padding-top: 1px;
}

.p-row .missing {
  color: color-mix(in srgb, var(--sub) 88%, transparent);
}

.official-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-strong);
  text-decoration: none;
  width: fit-content;
}

.official-link:hover {
  text-decoration: underline;
}

.visit-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.visit-btn {
  padding: 9px 18px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--gold) 50%, transparent);
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.visit-btn.been {
  background: var(--gold);
  color: #fff;
}

.visit-btn:hover {
  box-shadow: 0 4px 14px color-mix(in srgb, var(--gold) 35%, transparent);
}

.visit-sub {
  font-size: 12px;
  color: var(--sub);
  font-variant-numeric: tabular-nums;
}

.note {
  font-size: 12.5px;
  color: var(--gold);
  background: var(--gold-soft);
  border: 1px solid color-mix(in srgb, var(--gold) 30%, transparent);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin: 0;
}

.action {
  width: 100%;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.action:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  box-shadow: 0 0 16px var(--accent-soft);
}

/* ---------- 同省推荐 ---------- */

.related h3 {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--sub);
}

.related-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.related-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color 0.15s,
    background 0.15s,
    transform 0.15s;
}

.related-card:hover {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  transform: translateY(-1px);
}

.related-card .r-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.related-card .r-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
}

.related-card .r-city {
  font-size: 12px;
  color: var(--sub);
}

/* ---------- 数据来源折叠 ---------- */

.source-block {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}

.source-block summary {
  font-size: 12px;
  color: var(--sub);
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
  list-style: none;
}

.source-block summary::before {
  content: 'ⓘ';
}

.source-block summary::-webkit-details-marker {
  display: none;
}

.source-block summary:hover {
  color: var(--text);
}

.source-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-row {
  font-size: 11.5px;
  color: color-mix(in srgb, var(--sub) 90%, var(--text));
  display: flex;
  gap: 10px;
}

.source-row.dim {
  opacity: 0.65;
}

.source-label {
  flex: none;
  width: 56px;
  color: color-mix(in srgb, var(--sub) 75%, transparent);
}

.coords {
  font-variant-numeric: tabular-nums;
}

.wiki-link {
  font-size: 11.5px;
  color: var(--accent-strong);
  text-decoration: none;
  width: fit-content;
}

.wiki-link:hover {
  text-decoration: underline;
}

.detail-content {
  animation: detail-in 180ms ease-out;
}
@keyframes detail-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.drawer-enter-active {
  transition: opacity 280ms ease;
}
.drawer-leave-active {
  transition: opacity 180ms ease;
}
.drawer-enter-active .drawer {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-leave-active .drawer {
  transition: transform 180ms ease-in;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(100%);
}
@media (max-width: 600px) {
  .drawer {
    top: auto;
    left: 0;
    width: 100%;
    max-height: 90dvh;
    border-radius: 20px 20px 0 0;
    border: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .drawer-enter-from .drawer,
  .drawer-leave-to .drawer {
    transform: translateY(100%);
  }
}
</style>
