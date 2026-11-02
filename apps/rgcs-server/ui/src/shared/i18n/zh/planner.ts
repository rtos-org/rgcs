import type { plannerJa } from '../planner'

export const plannerZh: Record<keyof typeof plannerJa, string> = {
  upTitle: '选择要写入的飞行器',
  upAll: '全选',
  upNone: '全部取消',
  upWriteN: '写入 {n} 架飞行器',
  upTarget: '目标',
  upFatal: '未写入：检查发现致命问题',
  plSearch: '搜索地点',
  plSearchHint: '地名或地址，或 纬度, 经度',
  plSearchNone: '未找到',
  plSearchFail: '搜索失败',
  plToVehicle: '转到飞行器',
  plLoaded: '已加载 {n} 项',
  plFenceSide: '围栏设置',
  plRallySide: '集结点设置',
  plFileBad: '无法读取文件',
}
