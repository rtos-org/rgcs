// Copy for the plane / QuadPlane commands and the predicted flight path (2026-10-20).

export const planeCmdJa = {
  wp_LOITER_TO_ALT: '旋回して高度変更',
  wp_VTOL_TAKEOFF: 'VTOL 離陸',
  wp_VTOL_LAND: 'VTOL 着陸',
  wp_DO_VTOL_TRANSITION: 'VTOL 遷移',
  fld_ccwSign: '向き (負の値で反時計回り)',
  fld_xtrack: '接線から次へ',
  fld_fwApproach: '固定翼で進入',
  fld_vtolState: 'モード (3 マルチコプター / 4 固定翼)',
} as const

export const planeCmdEn: Record<keyof typeof planeCmdJa, string> = {
  wp_LOITER_TO_ALT: 'Loiter to altitude',
  wp_VTOL_TAKEOFF: 'VTOL takeoff',
  wp_VTOL_LAND: 'VTOL land',
  wp_DO_VTOL_TRANSITION: 'VTOL transition',
  fld_ccwSign: 'Direction (negative = counter-clockwise)',
  fld_xtrack: 'Track from tangent exit',
  fld_fwApproach: 'Fixed-wing approach',
  fld_vtolState: 'Mode (3 multicopter / 4 fixed wing)',
}
