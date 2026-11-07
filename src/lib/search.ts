import type { Spot } from '@/types'

export function normalizeQuery(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '')
}
export function searchSpots(spots: Spot[], query: string, limit = 8): Spot[] {
  const q = normalizeQuery(query)
  if (!q) return []
  return spots
    .map((spot, index) => {
      const name = normalizeQuery(spot.name)
      const score =
        name === q
          ? 0
          : name.startsWith(q)
            ? 1
            : name.includes(q)
              ? 2
              : normalizeQuery(spot.city).includes(q)
                ? 3
                : normalizeQuery(spot.province).includes(q)
                  ? 4
                  : normalizeQuery(spot.desc || '').includes(q)
                    ? 5
                    : Infinity
      return { spot, score, index }
    })
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((row) => row.spot)
}
