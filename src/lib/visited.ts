import { reactive, watch } from 'vue'

/**
 * 「我去过」打卡（localStorage 持久化，按景区名记录）。
 */
const STORAGE_KEY = 'scenic-visited'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed))
        return new Set(
          parsed.filter((name): name is string => typeof name === 'string' && name.length > 0),
        )
    }
  } catch {
    /* 忽略 */
  }
  return new Set()
}

export const visited = reactive({ names: load() })

watch(
  () => visited.names,
  (set) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
    } catch {
      /* 忽略（隐私模式等） */
    }
  },
  { deep: true },
)

export function toggleVisited(name: string): void {
  if (visited.names.has(name)) visited.names.delete(name)
  else visited.names.add(name)
}

export function isVisited(name: string): boolean {
  return visited.names.has(name)
}

export function visitedCount(): number {
  return visited.names.size
}
