// Copy for the operations map's "go to this waypoint" popover.

export const wpGoJa = {
  wpGoTitle: 'WP {n} へ行く',
  wpGoAutoHint: 'AUTO 以外では、次に AUTO にしたときこの WP から進みます',
  wpGoSend: '送信',
  wpGoLinkLost: '通信断のため送信できません',
} as const

export const wpGoEn: Record<keyof typeof wpGoJa, string> = {
  wpGoTitle: 'Go to WP {n}',
  wpGoAutoHint: 'Outside AUTO, the mission continues from this WP the next time AUTO is set',
  wpGoSend: 'Send',
  wpGoLinkLost: 'Link lost: cannot send',
}
