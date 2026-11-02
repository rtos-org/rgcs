import type { loginJa } from '../login'

export const loginKo: Record<keyof typeof loginJa, string> = {
  loginServer: '서버',
  loginSigningIn: '로그인 중…',
  loginSignedIn: '로그인했습니다',
  loginCredit: '出典: 国土地理院(シームレス空中写真)',
  loginServerUp: '서버 가동 중',
  loginServerUnknown: '서버 상태 알 수 없음',
  themeTitle: '로그인 화면 테마',
  themeAuto: '자동',
  themeDark: '다크',
  themeLight: '라이트',
  themeNote: '자동은 OS 설정을 따릅니다.',
}
