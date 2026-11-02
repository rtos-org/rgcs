import type { p9Ja } from '../p9'

export const p9Zh: Record<keyof typeof p9Ja, string> = {
  map3dUnavailable: '3D 需要高程瓦片（config.toml terrain_tiles）',
  ctxAlt: '高度',
  ctxBattery: '电池',
  fromHome: '距起飞点',
  holdToRun: '长按执行',
  quickModes: '快捷模式',
  emergency: '紧急操作',
  fleet: '全部飞行器：',
  guidedHere: 'Guided 移动到此处',
  sortAlerts: '警告优先',
  unreadAlerts: '未读警告',
  focusVehicle: '显示此飞行器',
}
