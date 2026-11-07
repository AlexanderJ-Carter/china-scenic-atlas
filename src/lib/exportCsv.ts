import type { Spot } from '@/types'

function cell(value: string | number): string {
  let text = String(value)
  // CSV 在电子表格中打开时，名称等文本不能变成公式。
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}

export function buildSpotsCsv(spots: Spot[], visited: ReadonlySet<string>): string {
  const rows: Array<Array<string | number>> = [
    ['景区名称', '等级', '省份', '城市', '记录年份（5A评定/4A收录）', '类别', '已打卡', '备注'],
    ...spots.map((s) => [
      s.name,
      s.level,
      s.province,
      s.city,
      s.year ?? '未知',
      s.category || '未分类',
      visited.has(s.name) ? '是' : '否',
      s.note ?? '',
    ]),
  ]
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')
}

export function downloadSpotsCsv(
  spots: Spot[],
  visited: ReadonlySet<string>,
  region: string,
): void {
  const blob = new Blob([buildSpotsCsv(spots, visited)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `景区清单-${region}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  // 为浏览器接收下载留出时间，不在 click 后立即撤销 URL。
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
