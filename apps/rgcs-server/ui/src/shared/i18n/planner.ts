// Copy for the planner additions of 2026-10-20: write-to-several-vehicles sheet, place search.

export const plannerJa = {
  upTitle: '書き込む機体を選択',
  upAll: 'すべて選択',
  upNone: 'すべて解除',
  upWriteN: '{n} 機に書き込む',
  upTarget: '対象機体',
  upFatal: '検証で致命的な問題があり書き込みませんでした',
  plSearch: '場所を検索',
  plSearchHint: '地名・住所、または 緯度, 経度',
  plSearchNone: '見つかりませんでした',
  plSearchFail: '検索できませんでした',
  plToVehicle: '機体の位置へ',
  plLoaded: '{n} 件を読み込みました',
  plFenceSide: 'フェンス設定',
  plRallySide: 'ラリーポイント設定',
  plFileBad: '読み込めませんでした',
} as const

export const plannerEn: Record<keyof typeof plannerJa, string> = {
  upTitle: 'Choose vehicles to write',
  upAll: 'Select all',
  upNone: 'Clear all',
  upWriteN: 'Write to {n} vehicles',
  upTarget: 'Target',
  upFatal: 'Not written: the check found fatal problems',
  plSearch: 'Search place',
  plSearchHint: 'Place or address, or lat, lon',
  plSearchNone: 'Nothing found',
  plSearchFail: 'Search failed',
  plToVehicle: 'Go to vehicle',
  plLoaded: 'Loaded {n}',
  plFenceSide: 'Fence settings',
  plRallySide: 'Rally point settings',
  plFileBad: 'Could not read the file',
}
