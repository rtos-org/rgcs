import type { wpGoJa } from '../wpGo'

export const wpGoKo: Record<keyof typeof wpGoJa, string> = {
  wpGoTitle: 'WP {n}(으)로 이동',
  wpGoAutoHint: 'AUTO가 아닐 때는 다음에 AUTO로 전환하면 이 WP부터 진행합니다',
  wpGoSend: '전송',
  wpGoLinkLost: '통신이 끊겨 전송할 수 없습니다',
}
