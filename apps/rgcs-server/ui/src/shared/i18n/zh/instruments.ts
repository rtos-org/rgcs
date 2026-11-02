import type { instrumentsJa } from '../instruments'

export const instrumentsZh: Record<keyof typeof instrumentsJa, string> = {
  instAttitude: '姿态',
  instHeading: '航向',
  instRoll: '横滚',
  instPitch: '俯仰',
  instNoData: '无数据',
}
