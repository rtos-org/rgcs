// Copy for P9: the 3D map and the operator improvements of 2026-10-19.

export const p9Ja = {
  map3dUnavailable: '標高タイルが設定されていないため 3D は使えません (config.toml terrain_tiles)',
  ctxAlt: '高度',
  ctxBattery: 'バッテリー',
  fromHome: 'ホームから',
  holdToRun: '長押しで実行',
  quickModes: 'クイックモード',
  emergency: '緊急操作',
  fleet: '全機',
  guidedHere: 'ここへ Guided 移動',
  sortAlerts: '警告順',
  unreadAlerts: '未読の警告',
  focusVehicle: 'この機体を表示',
} as const

export const p9En: Record<keyof typeof p9Ja, string> = {
  map3dUnavailable: '3D needs terrain tiles (config.toml terrain_tiles)',
  ctxAlt: 'Alt',
  ctxBattery: 'Battery',
  fromHome: 'From home',
  holdToRun: 'Hold to run',
  quickModes: 'Quick modes',
  emergency: 'Emergency',
  fleet: 'All vehicles:',
  guidedHere: 'Guided to here',
  sortAlerts: 'Alerts first',
  unreadAlerts: 'Unread alerts',
  focusVehicle: 'Show this vehicle',
}
