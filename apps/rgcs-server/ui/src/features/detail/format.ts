import type { Dict } from '../../shared/i18n'

const LINK_CODES: Record<string, keyof Dict> = { comms_delay: 'commsDelay', link_lost: 'linkLost', link_restored: 'linkRestored', sd_card_problem: 'sd_card_problem', auto_record_failed: 'auto_record_failed' }

/** Server-minted link codes are translated; text from the vehicle is shown verbatim. */
export function messageText(text: string, dict: Dict): string {
  const key = LINK_CODES[text]
  return key ? dict[key] : text
}
