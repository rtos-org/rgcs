import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { errorText } from './errorText'

describe('command error text', () => {
  it('translates server codes the operator can act on, else shows the server message', () => {
    expect(errorText('vtol_unknown', 'not yet known…', t('ja'))).toBe('機体の種類(VTOL)を確認中です。数秒後にもう一度')
    expect(errorText('vtol_unknown', 'not yet known…', t('en'))).toBe('Checking whether this plane is a VTOL; try again in a few seconds')
    expect(errorText('rejected', 'arm first', t('ja'))).toBe('arm first')
  })
})
