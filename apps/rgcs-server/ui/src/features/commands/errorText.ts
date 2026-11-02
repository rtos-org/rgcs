import type { Dict } from '../../shared/i18n'

/** Server refusal codes with their own operator text; any other refusal shows the server's message. */
const CODES: Readonly<Record<string, keyof Dict>> = { vtol_unknown: 'vtolUnknown' }

export function errorText(code: string, message: string, dict: Dict): string {
  const key = CODES[code]
  return key ? dict[key] : message
}
