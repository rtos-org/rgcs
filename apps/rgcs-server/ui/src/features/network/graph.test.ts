import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { clientSession, mavLink, netComponent, netVehicle, topology } from './fixture'
import { cameraLine, compLine, compTitle, graphSummary, linkPillValue, linkStatus, toGraph, vehicleStatus } from './graph'

const ja = t('ja')

describe('graph', () => {
  it('compLine lists the real components after FC', () => {
    const v = netVehicle(1, { components: [netComponent(154, 'gimbal'), netComponent(1, 'autopilot'), netComponent(100, 'camera')] })
    expect(compLine(v)).toBe('FC · AP 1 · CAM 100 · GMB 154')
    // the short codes are spelled out on hover
    expect(compTitle(v, ja)).toBe('フライトコントローラー: オートパイロット (コンポーネント 1) · カメラ (コンポーネント 100) · ジンバル (コンポーネント 154)')
    expect(compLine(netVehicle(2, { components: [] }))).toBe('FC · —')
  })

  it('vehicleStatus warns unless the link is ok', () => {
    expect(vehicleStatus(netVehicle(1, { link: 'delay' }))).toBe('warn')
    expect(vehicleStatus(netVehicle(1, { link: 'lost' }))).toBe('warn')
    expect(vehicleStatus(netVehicle(1, { link: 'ok' }))).toBe('ok')
  })

  it('linkStatus warns above 3 % loss or when disconnected', () => {
    expect(linkStatus(mavLink({ loss_pct: 3.0 }))).toBe('ok')
    expect(linkStatus(mavLink({ loss_pct: 3.01 }))).toBe('warn')
    expect(linkStatus(mavLink({ connected: false }))).toBe('warn')
    expect(linkStatus(mavLink({ stale: true, loss_pct: 0 }))).toBe('warn')
  })

  it('linkPillValue says no data on a stale link, else the short url', () => {
    const ja = t('ja')
    expect(linkPillValue(mavLink({ stale: true }), ja)).toBe('受信なし')
    expect(linkPillValue(mavLink({ url: 'tcp:127.0.0.1:5760' }), ja)).toBe('tcp:127.0.0.1:5760')
    expect(linkPillValue(mavLink({ url: 'tcp:127.0.0.1:5760' }), t('en'))).toBe('tcp:127.0.0.1:5760')
    expect(linkPillValue(mavLink({ stale: true }), t('en'))).toBe('No data')
  })

  it('counts warnings over vehicles, the link and the media server', () => {
    const g = toGraph(topology(1, { links: [mavLink()], vehicles: [netVehicle(1), netVehicle(2, { link: 'lost' })] }))
    expect(g.warnCount).toBe(1)
    expect(g.status.get('v:2')).toBe('warn')
    expect(g.status.get('link:link0')).toBe('ok')
    expect(g.link?.id).toBe('link0')
    const down = toGraph(topology(1, { links: [mavLink()], media: { whep_upstream: 'http://x', reachable: false } }))
    expect(down.warnCount).toBe(1)
    expect(down.status.get('media')).toBe('warn')
  })

  it('keeps clients and sorts vehicles by sysid', () => {
    const g = toGraph(topology(1, { vehicles: [netVehicle(3), netVehicle(1)], clients: [clientSession(1)] }))
    expect(g.vehicles.map((v) => v.sysid)).toEqual([1, 3])
    expect(g.clients).toHaveLength(1)
    expect(g.link).toBeNull()
  })

  it('cameraLine names the camera link, or says there is none', () => {
    const mt11 = { kind: 'siyi_mt11', transport: 'tcp_udp', endpoint: '192.168.144.25:37260', connected: true, firmware: null, last_error: null } as const
    expect(cameraLine(netVehicle(1, { camera: mt11 }), ja)).toEqual({ text: 'MT11 · 192.168.144.25:37260 · 接続', warn: false })
    expect(cameraLine(netVehicle(1, { camera: { ...mt11, connected: false } }), ja)).toEqual({ text: 'MT11 · 192.168.144.25:37260 · 未接続', warn: true })
    const mav = { kind: 'mavlink', transport: 'via_fc', endpoint: 'FC · compid 100', connected: true, firmware: null, last_error: null } as const
    expect(cameraLine(netVehicle(1, { camera: mav }), ja).text).toBe('MAVLink カメラ · FC 経由 · CAM 100')
    expect(cameraLine(netVehicle(1), ja).text).toBe('カメラなし')
  })
})

describe('graphSummary', () => {
  it('fills the bar summary from the graph', () => {
    const g = toGraph(topology(1, { links: [mavLink()], vehicles: [netVehicle(1), netVehicle(2, { link: 'lost' })], clients: [clientSession(1), clientSession(2), clientSession(3)] }))
    expect(graphSummary(g, ja)).toBe('1 リンク · 2 機体 · 1 警告 · 3 クライアント')
  })
})
