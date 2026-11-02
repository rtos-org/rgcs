import type { planeCmdJa } from '../plane'

export const planeCmdZh: Record<keyof typeof planeCmdJa, string> = {
  wp_LOITER_TO_ALT: '盘旋至高度',
  wp_VTOL_TAKEOFF: 'VTOL 起飞',
  wp_VTOL_LAND: 'VTOL 降落',
  wp_DO_VTOL_TRANSITION: 'VTOL 转换',
  fld_ccwSign: '方向（负值 = 逆时针）',
  fld_xtrack: '从切线出口开始航迹',
  fld_fwApproach: '固定翼进近',
  fld_vtolState: '模式（3 多旋翼 / 4 固定翼）',
}
