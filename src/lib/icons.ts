/** 类别 → 图标与渐变样式 key（详情插画兜底 / tooltip 点缀） */

interface CategoryStyle {
  icon: string
  cls: string
}

const MAP: Record<string, CategoryStyle> = {
  自然风光: { icon: '⛰️', cls: 'nature' },
  文化遗产: { icon: '🏯', cls: 'culture' },
  自然与文化双遗产: { icon: '🏞️', cls: 'dual' },
  红色旅游: { icon: '🚩', cls: 'red' },
  主题乐园: { icon: '🎡', cls: 'park' },
  博物馆: { icon: '🏛️', cls: 'museum' },
  园林景观: { icon: '🌿', cls: 'garden' },
  现代建筑: { icon: '🏙️', cls: 'modern' },
  边境风情: { icon: '🧭', cls: 'border' },
}

export function categoryStyle(category?: string): CategoryStyle {
  return MAP[category ?? ''] ?? { icon: '📍', cls: 'default' }
}
