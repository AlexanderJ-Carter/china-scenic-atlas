import { reactive, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'scenic-theme'

function initialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const theme = reactive<{ mode: ThemeMode }>({ mode: initialMode() })

export function toggleTheme(): void {
  theme.mode = theme.mode === 'light' ? 'dark' : 'light'
}

function apply(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#0e1a2c' : '#f4f7fb')
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* 忽略 */
  }
}

apply(theme.mode)
watch(() => theme.mode, apply)

/** 图表配色（构建 option 时读取，主题切换后重建即生效） */
export interface ChartPalette {
  ramp: string[]
  /** 区域渐变填充（上 → 下） */
  areaTop: string
  areaBottom: string
  border: string
  emphasis: string
  /** 聚焦视图中非当前区域的淡化底色 */
  dimArea: string
  dimBorder: string
  /** 聚焦视图中当前区域描边 */
  focusBorder: string
  text: string
  subText: string
  label: string
  level5a: string
  level5aGlow: string
  level4a: string
  level4aBorder: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}

export function chartPalette(): ChartPalette {
  if (theme.mode === 'light') {
    return {
      ramp: ['#eef4fb', '#cfe0f2', '#a6c7e8', '#7aa6d6', '#4d86c2'],
      areaTop: '#eef4fb',
      areaBottom: '#dde8f4',
      border: '#b9c8da',
      emphasis: '#cfe0f0',
      dimArea: '#f2f5f9',
      dimBorder: '#e4e9f0',
      focusBorder: '#7aa6d6',
      text: '#243447',
      subText: '#64748b',
      label: '#5b6b80',
      level5a: '#ea9c0f',
      level5aGlow: 'rgba(234, 156, 15, 0.45)',
      level4a: '#0d9488',
      level4aBorder: 'rgba(255, 255, 255, 0.9)',
      tooltipBg: 'rgba(255, 255, 255, 0.97)',
      tooltipBorder: '#d9e2ee',
      tooltipText: '#243447',
    }
  }
  return {
    ramp: ['#13283f', '#1c4266', '#27628f', '#3785b8', '#52a5d6'],
    areaTop: '#1c2f4c',
    areaBottom: '#12203a',
    border: '#3a628c',
    emphasis: '#234870',
    dimArea: '#101a2a',
    dimBorder: '#1c2b40',
    focusBorder: '#3785b8',
    text: '#e2ecf7',
    subText: '#93a8c0',
    label: '#8fa9c2',
    level5a: '#f5c66b',
    level5aGlow: 'rgba(245, 198, 107, 0.55)',
    level4a: '#3ed3c9',
    level4aBorder: 'rgba(62, 211, 201, 0.5)',
    tooltipBg: 'rgba(10, 20, 36, 0.94)',
    tooltipBorder: '#2f5c86',
    tooltipText: '#dce8f5',
  }
}

/* ---------------- 地貌模式色板 ---------------- */

/**
 * 地貌底图模式：按大区地理特征着色（林地/平原/丘陵/荒漠/高原），
 * 省份间以 adcode 派生的明度偏移制造自然过渡。
 * 与 aeryzhao/AAAAA 的纯色地图形成差异化。
 */
const TERRAIN_LIGHT: Record<string, string> = {
  华北: '#c9c19a', // 黄土/平原 沙黄
  东北: '#a8bd93', // 针阔混交林 灰绿
  华东: '#b5cfa0', // 江南水乡 青绿
  华中: '#a4c497', // 丘陵 翠绿
  华南: '#8bb98a', // 热带 深绿
  西南: '#b9b18c', // 山地 褐绿
  西北: '#d4c49e', // 荒漠 沙金
}

const TERRAIN_DARK: Record<string, string> = {
  华北: '#6b6543',
  东北: '#4a5a3c',
  华东: '#516548',
  华中: '#4a5c42',
  华南: '#3d543c',
  西南: '#5c5438',
  西北: '#6e5f3f',
}

/** 地貌模式某省的底色（大区色 + adcode 哈希明度偏移） */
export function terrainColor(region: string, adcode: number): string {
  const table = theme.mode === 'light' ? TERRAIN_LIGHT : TERRAIN_DARK
  const base = table[region] ?? table['华东']
  // adcode 哈希 → ±6% 明度，省份间自然深浅变化
  const offset = (((adcode % 13) / 12 - 0.5) * 0.12) as number
  return shade(base, offset)
}

/** 简单明度调整（hex → hex） */
function shade(hex: string, offset: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + offset))))
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
