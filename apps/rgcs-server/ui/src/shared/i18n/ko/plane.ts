import type { planeCmdJa } from '../plane'

export const planeCmdKo: Record<keyof typeof planeCmdJa, string> = {
  wp_LOITER_TO_ALT: '선회하며 고도 변경',
  wp_VTOL_TAKEOFF: 'VTOL 이륙',
  wp_VTOL_LAND: 'VTOL 착륙',
  wp_DO_VTOL_TRANSITION: 'VTOL 전환',
  fld_ccwSign: '방향(음수 = 반시계 방향)',
  fld_xtrack: '접선 이탈점부터 추적',
  fld_fwApproach: '고정익 진입',
  fld_vtolState: '모드(3 멀티콥터 / 4 고정익)',
}
