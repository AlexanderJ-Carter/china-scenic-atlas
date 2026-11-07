<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import TopBar from '@/components/TopBar.vue'
import StatsPanel from '@/components/StatsPanel.vue'
import MapPanel from '@/components/MapPanel.vue'
import SpotDetail from '@/components/SpotDetail.vue'
import { state } from '@/state'
import { DATA_META } from '@/data'
import '@/lib/theme'

watch(
  () => state.selectedSpot,
  (spot) => {
    if (spot) state.playing = false
  },
)

function onKeydown(e: KeyboardEvent): void {
  const target = e.target instanceof HTMLElement ? e.target : null
  if (
    e.key === '/' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !state.selectedSpot &&
    !target?.closest('input, textarea, select, [contenteditable]')
  ) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.search input')?.focus()
    return
  }
  if (e.key !== 'Escape') return
  if (state.selectedSpot) {
    state.selectedSpot = null
  } else if (state.view.mode === 'province') {
    state.view = { mode: 'national' }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app">
    <TopBar class="app-topbar" />
    <main class="app-main">
      <StatsPanel class="app-sidebar" />
      <MapPanel class="app-map" />
    </main>
    <footer class="app-footer">
      <span
        >数据快照 {{ DATA_META.generatedAt.slice(0, 10) }} · {{ DATA_META.spotCount5A }} 家 5A ·
        {{ DATA_META.spotCount4A }} 家 4A · 仅供学习交流</span
      >
    </footer>
    <SpotDetail />
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 12px;
  padding: 16px 18px 10px;
  max-width: 1600px;
  margin: 0 auto;
}

.app-main {
  display: grid;
  grid-template-columns: 302px 1fr;
  gap: 14px;
  min-height: 0;
  min-width: 0;
}

.app-sidebar {
  min-height: 0;
  min-width: 0;
}

.app-map {
  min-height: 0;
  min-width: 0;
}

.app-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: color-mix(in srgb, var(--sub) 80%, transparent);
  padding: 2px 4px;
}

.app-footer a {
  color: color-mix(in srgb, var(--accent) 70%, var(--sub));
  text-decoration: none;
}

.app-footer a:hover {
  color: var(--accent-strong);
}

@media (max-width: 900px) {
  .app {
    height: auto;
    min-height: 100dvh;
    padding: 12px;
  }

  .app-main {
    grid-template-columns: 1fr;
  }

  .app-sidebar {
    order: 2;
    max-height: none;
    height: auto;
    overflow: visible;
  }

  .app-map {
    order: 1;
    height: 55dvh;
    min-height: 340px;
  }
}
</style>
