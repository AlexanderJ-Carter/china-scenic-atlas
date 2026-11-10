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
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#111112' : '#f8f4ed')
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
      ramp: ['#dbecff', '#78beff', '#2694fe', '#004cbc', '#02165e'],
      areaTop: '#f8f4ed',
      areaBottom: '#efe8db',
      border: '#ccd3db',
      emphasis: '#e8f3ff',
      dimArea: '#f3eee5',
      dimBorder: '#e4ddd0',
      focusBorder: '#0171e3',
      text: '#15110c',
      subText: '#4e606f',
      label: '#4e606f',
      level5a: '#e2a400',
      level5aGlow: 'rgba(226, 164, 0, 0.45)',
      level4a: '#08a3a3',
      level4aBorder: 'rgba(255, 255, 255, 0.92)',
      tooltipBg: 'rgba(255, 255, 255, 0.97)',
      tooltipBorder: 'rgba(5, 54, 89, 0.12)',
      tooltipText: '#15110c',
    }
  }
  return {
    ramp: ['#02165e', '#004cbc', '#2694fe', '#78beff', '#dbecff'],
    areaTop: '#1f1f22',
    areaBottom: '#161618',
    border: '#494d53',
    emphasis: '#28292c',
    dimArea: '#141416',
    dimBorder: '#2a2b2f',
    focusBorder: '#2694fe',
    text: '#dfe2e5',
    subText: '#aaafb5',
    label: '#aaafb5',
    level5a: '#fbce03',
    level5aGlow: 'rgba(251, 206, 3, 0.5)',
    level4a: '#40dccd',
    level4aBorder: 'rgba(64, 220, 205, 0.45)',
    tooltipBg: 'rgba(31, 31, 34, 0.96)',
    tooltipBorder: 'rgba(242, 244, 246, 0.12)',
    tooltipText: '#dfe2e5',
  }
}

/* ---------------- 地貌模式色板 ---------------- */

/**
 * 地貌底图模式：按大区地理特征着色（林地/平原/丘陵/荒漠/高原），
 * 省份间以 adcode 派生的明度偏移制造自然过渡。
 */
const TERRAIN_LIGHT: Record<string, string> = {
  华北: '#c9c19a',
  东北: '#a8bd93',
  华东: '#b5cfa0',
  华中: '#a4c497',
  华南: '#8bb98a',
  西南: '#b9b18c',
  西北: '#d4c49e',
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
