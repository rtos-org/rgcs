import { describe, expect, it } from 'vitest'
import type { LogEntry, Severity } from '../../shared/api/types'
import { EMPTY_LOG, LOG_MAX, logReduce, toLogEntry } from './store'
import { vm } from '../../test/vm'

const e = (id: number, severity: Severity = 'info', sysid: number | null = 1): LogEntry => ({
  id,
  ts: id * 1000,
  sysid,
  source: 'vehicle',
  severity,
  text: `m${id}`,
  ackable: severity === 'warn' || severity === 'error',
  acked_by: null,
  acked_at: null,
})

describe('logReduce', () => {
  it('entry_dedupes_and_counts_only_alerts', () => {
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: e(1, 'warn') })
    s = logReduce(s, { k: 'entry', entry: e(1, 'warn') })
    s = logReduce(s, { k: 'entry', entry: e(2, 'info') })
    s = logReduce(s, { k: 'entry', entry: e(3, 'error') })
    s = logReduce(s, { k: 'entry', entry: e(4, 'ok') })
    expect(s.entries.map((x) => x.id)).toEqual([4, 3, 2, 1])
    expect(s.unreadAlerts).toBe(2)
    expect(EMPTY_LOG.entries).toHaveLength(0)
  })

  it('opening_resets_unread', () => {
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: e(1, 'warn') })
    s = logReduce(s, { k: 'open', filter: 2 })
    expect([s.open, s.unreadAlerts, s.filter]).toEqual([true, 0, 2])
    s = logReduce(s, { k: 'entry', entry: e(2, 'error') })
    expect(s.unreadAlerts).toBe(0)
    s = logReduce(s, { k: 'close' })
    s = logReduce(s, { k: 'entry', entry: e(3, 'error') })
    expect([s.open, s.unreadAlerts]).toEqual([false, 1])
    expect(logReduce(s, { k: 'open' }).filter).toBe('all')
  })

  it('burst_keeps_one_line_and_counts_alerts', () => {
    let s = EMPTY_LOG
    for (let i = 1; i <= 600; i++)
      s = logReduce(s, {
        k: 'entry',
        entry: e(i, i % 3 === 0 ? 'warn' : 'info'),
      })
    expect(s.entries).toHaveLength(LOG_MAX)
    expect(s.entries[0].id).toBe(600)
    expect(s.unreadAlerts).toBe(s.entries.filter((x) => x.severity === 'warn').length)
  })

  it('loaded_merges_history_without_counting_it', () => {
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: e(5, 'warn') })
    s = logReduce(s, {
      k: 'loaded',
      entries: [e(5, 'warn'), e(4, 'error'), e(2)],
    })
    expect(s.entries.map((x) => x.id)).toEqual([5, 4, 2])
    expect(s.unreadAlerts).toBe(1)
  })

  it('ack_marks_the_entry', () => {
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: e(1, 'warn') })
    s = logReduce(s, { k: 'ack', id: 1, by: 'admin', ts: 9 })
    expect([s.entries[0].acked_by, s.entries[0].acked_at]).toEqual(['admin', 9])
    expect(logReduce(s, { k: 'ack', id: 1, by: 'other', ts: 10 })).toBe(s)
  })

  it('a_vehicle_message_becomes_an_entry', () => {
    const x = toLogEntry(vm({ id: 7, sysid: 2, severity: 3, text: 'crash', ts: 5 }))
    expect(x).toEqual({
      id: 7,
      ts: 5,
      sysid: 2,
      source: 'vehicle',
      severity: 'error',
      text: 'crash',
      ackable: true,
      acked_by: null,
      acked_at: null,
    })
  })
  it('a_reload_brings_in_acknowledgements_made_while_offline', () => {
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: e(5, 'error') })
    s = logReduce(s, { k: 'loaded', entries: [{ ...e(5, 'error'), acked_by: 'other', acked_at: 9 }] })
    expect([s.entries[0]!.acked_by, s.entries[0]!.acked_at]).toEqual(['other', 9])
  })

  it('order_follows_server_ids_and_arrival_not_wall_clocks', () => {
    // the Pi's clock runs hours behind the browser: server rows carry small ts, a local failure a big one
    const server = (id: number) => ({ ...e(id, 'warn'), ts: id })
    const local = { ...e(-1_000_000, 'error'), sysid: 1, source: 'command' as const, ts: 9_999_999_999 }
    let s = logReduce(EMPTY_LOG, { k: 'entry', entry: server(1) })
    s = logReduce(s, { k: 'entry', entry: local })
    s = logReduce(s, { k: 'entry', entry: server(2) })
    expect(s.entries.map((x) => x.id)).toEqual([2, -1_000_000, 1])
    s = logReduce(s, { k: 'loaded', entries: [server(3), server(2), server(1)] })
    expect(s.entries.map((x) => x.id)).toEqual([3, 2, -1_000_000, 1])
  })
})
