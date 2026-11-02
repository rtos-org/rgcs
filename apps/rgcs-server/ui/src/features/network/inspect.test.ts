import { describe, expect, it } from 'vitest'
import { t as dictFor } from '../../shared/i18n'
import type { NetworkTopology } from '../../shared/api/types'
import { clientSession, mavLink, netComponent, netVehicle, topology } from './fixture'
import { fmtAge, fmtBytes, fmtRate, inspect, summary, type Inspection } from './inspect'

const ja = dictFor('ja')
const en = dictFor('en')
const NOW = 1_000_000

// The topology shape the server sends: one link, two vehicles, two clients, a reachable MediaMTX.
const fixture = (o: Partial<NetworkTopology> = {}): NetworkTopology =>
  topology(NOW, {
    server: { hostname: 'gcs', version: '0.1.0', build: 'dev', listen: '127.0.0.1:8110', role: 'standalone', uptime_s: 42, started_unix_ms: 0 },
    links: [
      mavLink({
        rx_msgs_per_s: 32,
        rx_bytes_per_s: 1434,
        systems: [
          { sysid: 1, vehicle: true, components: [netComponent(1, 'autopilot')] },
          { sysid: 255, vehicle: false, components: [netComponent(190, 'gcs')] },
        ],
      }),
    ],
    vehicles: [
      netVehicle(1, {
        components: [netComponent(1, 'autopilot', { rx_msgs_per_s: 30, loss_pct: 0, last_rx_age_ms: 100 })],
        camera: { kind: 'siyi_mt11', transport: 'tcp_udp', endpoint: '192.168.144.25:37260', connected: true, firmware: null, last_error: null },
        video: { source: 'mt11', probe_ok: true, scanning: false, whep_path: '/mt11' },
      }),
      netVehicle(2),
    ],
    clients: [clientSession(1, { addr: '127.0.0.1:51000', connected_since_unix_ms: NOW - 65_000 }), clientSession(2)],
    media: { whep_upstream: 'http://127.0.0.1:8889/mt11/whep', reachable: true },
    ...o,
  })

const kv = (i: Inspection, k: string) => i.kv.find((r) => r.k === k)

describe('inspect', () => {
  it('describes the server with its clients and media server', () => {
    const i = inspect('server', fixture(), ja, NOW)
    expect([i.title, i.sub, i.icon]).toEqual(['rgcs-server', 'スタンドアロン', 'server'])
    // readable labels; the role row is gone, the subtitle already says スタンドアロン
    expect(kv(i, 'バージョン')?.v).toBe('0.1.0 (dev)')
    expect(kv(i, '待受アドレス')?.v).toBe('127.0.0.1:8110')
    expect(kv(i, '役割')).toBeUndefined()
    expect(kv(i, '稼働時間')?.v).toBe('42 s')
    expect(kv(i, '映像サーバー')?.v).toBe('http://127.0.0.1:8889/mt11/whep · 到達可')
    const tb = i.tables.find((x) => x.title === 'クライアント')
    expect(tb?.rows[0].map((c) => c.v)).toEqual(['admin', 'admin', '127.0.0.1:51000', 'Chrome'])
  })

  it('describes a vehicle with its real route, components, camera and video', () => {
    const i = inspect('v:1', fixture(), ja, NOW)
    expect([i.title, i.sub, i.icon]).toEqual(['UAV-01', 'Copter · SYSID 1', 'copter'])
    expect(kv(i, '経路')?.v).toBe('UAV-01 → MAVLink (tcp:127.0.0.1:5760) → rgcs-server → クライアント 2')
    expect(kv(i, '通信経路')?.v).toBe('MAVLink 直結')
    expect(kv(i, 'クラウド経路')).toEqual({ k: 'クラウド経路', v: '未構成（Hub なし）', cls: 'dim' })
    expect(kv(i, 'ハートビート')?.v).toBe('0.4 s')
    expect(kv(i, 'rgcs-node')?.v).toBe('未構成')
    expect(kv(i, 'カメラ')?.v).toBe('MT11 · 192.168.144.25:37260 · 接続')
    expect(kv(i, '映像')?.v).toBe('mt11 · RTSP OK · /mt11')
    const tb = i.tables.find((x) => x.title === 'コンポーネント')
    expect(tb?.head).toEqual(['COMPID', '種類', 'msg/s', 'ロス', '最終受信'])
    expect(tb?.rows[0].map((c) => c.v)).toEqual(['1', 'AP', '30.0', '0.0 %', '0.1 s'])
  })

  it('marks a lost vehicle', () => {
    const t = fixture({ vehicles: [netVehicle(1, { link: 'lost' })] })
    const i = inspect('v:1', t, ja, NOW)
    expect(kv(i, '経路')?.cls).toBe('warn')
    expect(kv(i, '状態')?.v).toBe('通信断')
  })

  it('treats the MAVLink dot and edge as the vehicle', () => {
    expect(inspect('r:1', fixture(), ja, NOW).title).toBe('UAV-01')
    expect(inspect('e:v:1', fixture(), ja, NOW).title).toBe('UAV-01')
  })

  it('describes the link with its systems', () => {
    const i = inspect('link:link0', fixture(), ja, NOW)
    expect(i.icon).toBe('cable')
    expect(kv(i, '受信 (推定)')?.v).toBe('32.0 msg/s · 1.4 KB/s')
    expect(kv(i, 'ロス')?.v).toBe('0.0 %')
    expect(kv(i, '再接続')?.v).toBe('0')
    const tb = i.tables.find((x) => x.title === 'システム')
    expect(tb?.rows.map((r) => [r[0].v, r[1].v])).toEqual([
      ['1', '機体'],
      ['255', 'GCS 190'],
    ])
    expect(i.note).toBe('詳細は MAVLink インスペクター')
  })

  it('marks a connected link with no data as stale', () => {
    const t = fixture()
    const stale = { ...t, links: t.links.map((l) => ({ ...l, stale: true })) }
    const st = kv(inspect('link:link0', stale, ja, NOW), '状態')
    expect(st?.v).toBe('受信なし')
    expect(st?.cls).toBe('warn')
    expect(kv(inspect('link:link0', t, ja, NOW), '状態')?.cls).toBe('ok')
  })

  it('describes a client', () => {
    const i = inspect('c:1', fixture(), ja, NOW)
    expect([i.title, i.sub, i.icon]).toEqual(['admin', 'admin · Chrome', 'laptop'])
    expect(kv(i, 'アドレス')?.v).toBe('127.0.0.1:51000')
    expect(kv(i, '接続から')?.v).toBe(fmtAge(65_000, ja))
    expect(inspect('e:c:1', fixture(), ja, NOW).title).toBe('admin')
  })

  it.each([
    ['ph:hub', 'RGCS Hub'],
    ['ph:lte:1', 'LTE'],
    ['ph:gw', 'メッシュ GW'],
    ['ph:ntrip', 'NTRIP caster'],
    ['e:ph:uplink', '上り回線'],
  ])('explains the unconfigured %s', (sel, title) => {
    const i = inspect(sel, fixture(), ja, NOW)
    expect(i.title).toBe(title)
    expect(kv(i, '状態')).toEqual({ k: '状態', v: '未構成', cls: 'dim' })
    expect(i.note).toBe(ja.netNoteM5)
  })

  it('describes the media server', () => {
    const i = inspect('media', fixture({ media: { whep_upstream: 'http://h:8889/x', reachable: false } }), ja, NOW)
    expect(i.icon).toBe('video')
    expect(kv(i, '状態')).toEqual({ k: '状態', v: '到達不可', cls: 'warn' })
  })

  it('falls back to the server for an unknown or vanished id', () => {
    expect(inspect('v:9', fixture(), ja, NOW).title).toBe('rgcs-server')
    expect(inspect('c:9', fixture(), ja, NOW).title).toBe('rgcs-server')
    expect(inspect('nonsense', fixture(), ja, NOW).title).toBe('rgcs-server')
  })
})

describe('formatting', () => {
  it('formats rates, bytes and ages', () => {
    expect(fmtRate(9.96)).toBe('10.0')
    expect(fmtRate(0)).toBe('0.0')
    expect(fmtBytes(210)).toBe('210 B/s')
    expect(fmtBytes(2048)).toBe('2.0 KB/s')
    expect(fmtBytes(1_500_000)).toBe('1.4 MB/s')
    expect(fmtAge(null)).toBe('—')
    expect(fmtAge(400)).toBe('0.4 s')
    expect(fmtAge(42_000)).toBe('42 s')
    expect(fmtAge(65_000)).toBe('1 分 5 秒')
    expect(fmtAge(65_000, en)).toBe('1 min 5 s')
    expect(fmtAge(3_725_000)).toBe('1 時間 2 分')
  })

  it('summarises links, vehicles, warnings and clients', () => {
    const t = fixture({ vehicles: [netVehicle(1), netVehicle(2, { link: 'lost' })] })
    expect(summary(t, ja)).toBe('1 リンク · 2 機体 · 1 警告 · 2 クライアント')
  })
})
