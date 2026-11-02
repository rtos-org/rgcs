import type { p9Ja } from '../p9'

export const p9Ko: Record<keyof typeof p9Ja, string> = {
  map3dUnavailable: '3D에는 표고 타일이 필요합니다(config.toml terrain_tiles)',
  ctxAlt: '고도',
  ctxBattery: '배터리',
  fromHome: '홈에서',
  holdToRun: '길게 눌러 실행',
  quickModes: '빠른 모드',
  emergency: '비상 조작',
  fleet: '전체 기체:',
  guidedHere: '여기로 Guided 이동',
  sortAlerts: '경보 우선',
  unreadAlerts: '읽지 않은 경보',
  focusVehicle: '이 기체 표시',
}
