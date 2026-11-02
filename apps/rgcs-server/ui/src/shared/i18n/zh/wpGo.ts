import type { wpGoJa } from '../wpGo'

export const wpGoZh: Record<keyof typeof wpGoJa, string> = {
  wpGoTitle: '前往航点 {n}',
  wpGoAutoHint: '非 AUTO 模式时，下次切换到 AUTO 将从此航点继续任务',
  wpGoSend: '发送',
  wpGoLinkLost: '链路丢失：无法发送',
}
