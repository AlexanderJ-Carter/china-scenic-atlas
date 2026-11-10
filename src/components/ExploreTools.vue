<script setup lang="ts">
import { computed, ref } from 'vue'
import { PROVINCES } from '@/data/provinces'
import { state } from '@/state'
import { currentSpots } from '@/lib/filter'
import { downloadSpotsCsv } from '@/lib/exportCsv'
import { visited } from '@/lib/visited'
import { loading4a, error4a } from '@/lib/spots4a'

const notice = ref('')
const exporting = ref(false)
const region = computed({
  get: () => (state.view.mode === 'national' ? '' : state.view.short),
  set: (value: string) => {
    const p = PROVINCES.find((p) => p.short === value)
    state.view = p
      ? { mode: 'province', adcode: p.adcode, short: p.short, full: p.full, kind: p.kind }
      : { mode: 'national' }
  },
})
function exportList(): void {
  exporting.value = true
  notice.value = ''
  const spots = [...currentSpots.value]
  const names = new Set(visited.names)
  const title = region.value || '全国'
  try {
    downloadSpotsCsv(spots, names, title)
    notice.value = `已生成 ${spots.length} 家景区的 CSV 清单`
  } catch {
    notice.value = '导出失败，请重试'
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="explore-tools" aria-label="探索工具">
    <h3>探索工具</h3>
    <label
      >快速切换区域
      <select v-model="region" aria-label="快速切换区域">
        <option value="">全国</option>
        <option
          v-for="p in PROVINCES"
          :key="p.adcode"
          :value="p.short"
          :disabled="p.adcode === 710000"
        >
          {{ p.full }}{{ p.adcode === 710000 ? '（暂无景区数据）' : '' }}
        </option>
      </select>
    </label>
    <label
      >我的足迹
      <select v-model="state.visitFilter" aria-label="打卡状态筛选">
        <option value="all">全部景区</option>
        <option value="visited">只看已打卡</option>
        <option value="unvisited">只看未打卡</option>
      </select>
    </label>
    <button
      class="ink-button export-list"
      :disabled="
        !currentSpots.length || exporting || (state.levels['4A'] && (loading4a || Boolean(error4a)))
      "
      @click="exportList"
    >
      {{ exporting ? '正在生成…' : `导出当前 ${currentSpots.length} 家景区` }}
    </button>
    <p>遵循当前区域和筛选条件 · CSV 格式<br />打卡仅保存在当前浏览器</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.explore-tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--panel-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
h3 {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--sub);
}
select {
  width: 100%;
  min-height: 36px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font: inherit;
}
.export-list {
  width: 100%;
  text-align: center;
}
p {
  margin: 0;
  color: var(--sub);
  font-size: 11px;
  line-height: 1.6;
}
@media (pointer: coarse) {
  select {
    min-height: 44px;
    font-size: 16px;
  }
}
</style>
