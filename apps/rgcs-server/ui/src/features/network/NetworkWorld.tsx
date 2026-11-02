// The network canvas world, a port of the prototype's `netSvg` / `netSiteSvg` for one standalone site
//. Real elements: vehicles, the MAVLink link, rgcs-server, media, WS clients.
// Everything else the M5 design draws is a dim dashed 未構成 placeholder (`ph`).
import type { ReactElement } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconGlobe, IconLaptop, IconRadioTower, IconRouter, IconServer } from '../../shared/ui/icons'
import { graphSummary, linkPillValue, type NetGraph } from './graph'
import { clientY, gatewayY, linkPillY, MEDIA_PILL_W, mediaPillX, VH, VW, zoneLabelFs, type NetLayout } from './layout'
import { Card, Edge, Node, Pill, SvgIcon, VehicleBlock, Zone, type Kit, type PillState } from './svgParts'
import type { Lod } from './viewport'

interface Layers {
  readonly back: readonly ReactElement[]
  readonly edges: readonly ReactElement[]
  readonly nodes: readonly ReactElement[]
  readonly top: readonly ReactElement[]
}

interface Ctx {
  readonly g: NetGraph
  readonly l: NetLayout
  readonly lod: Lod
  readonly kit: Kit
  readonly dict: Dict
}

/** An uplink drawn from the site into the Internet band and on to the Hub (all placeholders today). */
interface Up {
  readonly id: string
  readonly edge: string
  readonly y: number
  readonly from: number
  readonly label: string
}

const layers = (p: Partial<Layers>): Layers => ({ back: p.back ?? [], edges: p.edges ?? [], nodes: p.nodes ?? [], top: p.top ?? [] })
const merge = (...ls: readonly Layers[]): Layers => ({
  back: ls.flatMap((x) => x.back),
  edges: ls.flatMap((x) => x.edges),
  nodes: ls.flatMap((x) => x.nodes),
  top: ls.flatMap((x) => x.top),
})
const bundled = (g: NetGraph): boolean => g.vehicles.length > 8

function vehicles({ g, l, lod, kit, dict }: Ctx): Layers {
  const gw: readonly [number, number] = [l.vx, l.gwY]
  return merge(
    ...g.vehicles.map((v) => {
      const [x, y] = l.pos.get(v.sysid) ?? [l.vx, 0]
      const status = g.status.get(`v:${v.sysid}`) ?? 'ok'
      const block = <VehicleBlock key={`v:${v.sysid}`} kit={kit} v={v} x={x} y={y} w={VW} h={VH} lod={lod} status={status} dict={dict} />
      if (lod === 'site') return layers({ nodes: [block] })
      const [x1, y1] = [x, y + VH / 2]
      const bg = 34 + Math.abs(gw[1] - y1) * 0.2
      const d = l.cols > 1 ? `M${x1},${y1} L${gw[0]},${gw[1]}` : `M${x1},${y1} C ${x1 - bg},${y1} ${gw[0]},${gw[1] - 80} ${gw[0]},${gw[1]}`
      const cls = `mesh pick route${status === 'warn' ? ' warn' : ''}`
      return layers({
        edges: [<Edge key={`e:v:${v.sysid}`} kit={kit} id={`e:v:${v.sysid}`} cls={cls} d={d} />],
        nodes: [
          block,
          <Node key={`r:${v.sysid}`} kit={kit} id={`r:${v.sysid}`}>
            <circle className="mdot" cx={x1} cy={y1} r={lod === 'full' ? 6 : 9} />
          </Node>,
        ],
      })
    }),
  )
}

function mediaPill({ g, l, kit, dict }: Ctx): ReactElement {
  const r = g.media.reachable
  const val = r === null ? dict.netChecking : r ? dict.netReachable : dict.netUnreachable
  const state: PillState = r === null ? 'idle' : r ? 'ok' : 'warn'
  return <Pill key="media" kit={kit} id="media" x={mediaPillX(l)} y={l.gwY + 24} w={MEDIA_PILL_W} label={dict.netVideo} val={val} state={state} />
}

/** rgcs-server in the GW slot, its link and media pills, and the WS clients hanging under it. */
function server(ctx: Ctx): Layers {
  const { g, l, kit, dict } = ctx
  const x = l.vx - 110
  const link = g.link
  const linkPill =
    link === null ? [] : [<Pill key="link" kit={kit} id={`link:${link.id}`} x={x} y={linkPillY(l)} w={200} label="MAVLink" val={linkPillValue(link, dict)} state={g.status.get(`link:${link.id}`) ?? 'ok'} />]
  const clientEdges = g.clients.map((c, i) => {
    const cy = clientY(l, i)
    const d = i === 0 ? `M${l.vx},${l.gwY + 48} V${cy}` : `M${l.vx},${l.gwY + 48} V${l.gwY + 80} H${l.vx - 122} V${cy + 24} H${x}`
    return <Edge key={`e:c:${c.id}`} kit={kit} id={`e:c:${c.id}`} cls="video" d={d} />
  })
  const clients = g.clients.map((c, i) => (
    <Card key={`c:${c.id}`} kit={kit} id={`c:${c.id}`} x={x} y={clientY(l, i)} w={220} h={48} icon={IconLaptop} title={c.username} sub={`${c.addr ?? '—'} · ${c.browser}`} />
  ))
  return layers({
    edges: clientEdges,
    nodes: [
      <Card key="server" kit={kit} id="server" x={x} y={l.gwY} w={220} h={48} icon={IconServer} title="rgcs-server" sub={`${g.server.listen} · ${dict.netServerSub}`} />,
      ...clients,
      <Card key="ph:gw" kit={kit} id="ph:gw" x={x} y={gatewayY(l, g.clients.length)} w={220} h={48} icon={IconRouter} title={dict.netGateway} sub={dict.netUnconfigured} extra=" ph" />,
      <text key="fieldop" className="ncolh" x={l.vx + 156} y={l.gwY + 74}>
        {dict.netFieldOp}
      </text>,
    ],
    top: [...linkPill, mediaPill(ctx), <Pill key="ws" kit={kit} id="ws" x={l.vx + 12} y={l.gwY + 70} w={132} label={dict.netWsLocal} state="rtc" />],
  })
}

/** At the site LOD the vehicles become tiles under one summary card (selecting it selects the server). */
function siteCard({ g, l, lod, kit, dict }: Ctx): Layers {
  if (lod !== 'site') return layers({})
  const w = l.zone.w - 32, cx = l.zone.x + l.zone.w / 2, y = l.zone.y + 90
  const parts = graphSummary(g, dict).split(' · ')
  const lines = [parts.slice(0, 2).join(' · '), parts.slice(2).join(' · ')]
  return layers({
    top: [
      <g key="site" className={`nn nsite${kit.sel === 'site:A' ? ' sel' : ''}`} data-id="site:A">
        <rect className="card" x={cx - w / 2} y={y} width={w} height={190} rx={28} />
        <text x={cx} y={y + 66} fontSize={52} fontWeight={600} textAnchor="middle">
          {dict.netZoneSite}
        </text>
        {lines.map((t, i) => (
          <text key={t} x={cx} y={y + 118 + i * 40} fontSize={28} textAnchor="middle" className="t2">
            {t}
          </text>
        ))}
      </g>,
    ],
  })
}

function ups({ g, l, dict }: Ctx): readonly Up[] {
  const lte: readonly Up[] = bundled(g)
    ? [{ id: 'ph:lte', edge: 'e:ph:lte', y: 62 + (l.rows * 77) / 2, from: l.zone.x + l.zone.w, label: `LTE × ${g.vehicles.length}` }]
    : g.vehicles.map((v) => {
        const [x, y] = l.pos.get(v.sysid) ?? [l.vx, 0]
        return { id: `ph:lte:${v.sysid}`, edge: `e:ph:lte:${v.sysid}`, y: y + VH / 2, from: x + VW, label: 'LTE' }
      })
  const gy = gatewayY(l, g.clients.length)
  return [...lte, { id: 'ph:uplink', edge: 'e:ph:uplink', y: gy + 24, from: l.vx + 110, label: dict.netUplink }]
}

function uplinks(ctx: Ctx): Layers {
  const { l, lod, kit, dict } = ctx
  const list = ups(ctx)
  const S = l.S, P = S * (lod === 'site' ? 1.4 : 1), fieldR = l.zone.x + l.zone.w
  return merge(
    ...list.map((u, i) => {
      const ey = l.HY + (28 + i * (144 / Math.max(1, list.length - 1))) * S
      const d = `M${u.from},${u.y} H${l.IX} C ${l.IX + l.IW * 0.7},${u.y} ${l.IX + l.IW * 0.3},${ey} ${l.HX},${ey}`
      return layers({
        edges: [<Edge key={u.edge} kit={kit} id={u.edge} cls="mav ph" d={d} />],
        top: [<Pill key={u.id} kit={kit} id={u.id} x={fieldR + 16} y={u.y} w={150} label={u.label} val={dict.netUnconfigured} state="ph" sc={P} />],
      })
    }),
  )
}

function zones({ l, lod, dict }: Ctx): Layers {
  const S = l.S, big = lod === 'full' ? 1 : lod === 'compact' ? 2 : 4, fs = Math.min(11 * big, 11 * S * big)
  const z = l.zone
  return layers({
    back: [
      <Zone key="z:site" x={z.x} y={z.y} w={z.w} h={z.h} label={dict.netZoneSite} fs={11 * big} />,
      <Zone key="z:inet" x={l.IX - 10 * S} y={18} w={l.IW + 20 * S} h={l.H - 26} label={dict.netZoneInet} tone="inet" fs={fs} />,
      <Zone key="z:cloud" x={l.HX - 20 * S} y={18} w={l.HW + 40 * S} h={l.H - 26} label={dict.netZoneCloud} tone="cloud" fs={fs} />,
    ],
    nodes: [<SvgIcon key="globe" icon={IconGlobe} x={l.IX + l.IW / 2 - 11 * S} y={18 + zoneLabelFs(dict.netZoneInet, l.IW + 20 * S, fs) * 1.4 + 22} size={22 * S} />],
  })
}

/** The Hub, remote users and NTRIP: drawn at base size and scaled by S, all 未構成. */
function cloud({ l, kit, dict }: Ctx): Layers {
  const S = l.S, UY = 62 + 40 * S, XY = UY + (58 + 80) * S, hr = l.HX + l.HW
  const column = (key: string, top: number, head: string, card: ReactElement) => (
    <g key={key} transform={`translate(${l.UX},${top}) scale(${S})`}>
      <text className="ncolh" x={0} y={-14}>
        {head}
      </text>
      {card}
    </g>
  )
  return layers({
    edges: [
      <Edge key="e:ph:users" kit={kit} id="e:ph:users" cls="video ph" d={`M${hr},${l.HY + 70 * S} C ${hr + 40 * S},${l.HY + 70 * S} ${l.UX - 40 * S},${UY + 24 * S} ${l.UX},${UY + 24 * S}`} />,
      <Edge key="e:ph:ntrip" kit={kit} id="e:ph:ntrip" cls="rtcm ph" d={`M${l.UX},${XY + 24 * S} C ${l.UX - 40 * S},${XY + 24 * S} ${hr + 40 * S},${l.HY + 150 * S} ${hr},${l.HY + 150 * S}`} />,
    ],
    nodes: [
      <g key="hub" transform={`translate(${l.HX},${l.HY}) scale(${S})`}>
        <Node kit={kit} id="ph:hub" extra=" ph">
          <rect className="card" x={0} y={0} width={176} height={200} rx={16} />
          <SvgIcon icon={IconServer} x={74} y={34} size={28} />
          <text x={88} y={92} fontSize={17} fontWeight={600} textAnchor="middle">
            {dict.netHub}
          </text>
          <text x={88} y={116} fontSize={11.5} textAnchor="middle" className="t2">
            {dict.netUnconfigured}
          </text>
        </Node>
      </g>,
      column('users', UY, dict.netUsersRemote, <Card kit={kit} id="ph:users" x={0} y={0} w={170} h={48} icon={IconLaptop} title={dict.netRemoteUsers} sub={`Hub ${dict.netUnconfigured}`} extra=" ph" />),
      column('ext', XY, dict.netExternal, <Card kit={kit} id="ph:ntrip" x={0} y={0} w={170} h={48} icon={IconRadioTower} title={dict.netNtrip} sub={dict.netUnconfigured} extra=" ph" />),
    ],
  })
}

export interface NetworkWorldProps {
  readonly graph: NetGraph
  readonly layout: NetLayout
  readonly lod: Lod
  readonly kit: Kit
  readonly dict: Dict
}

/** All layers in paint order: zones, edges, nodes, then pills and overlays on top. */
export function NetworkWorld({ graph, layout, lod, kit, dict }: NetworkWorldProps) {
  const ctx: Ctx = { g: graph, l: layout, lod, kit, dict }
  const all = merge(zones(ctx), vehicles(ctx), server(ctx), uplinks(ctx), cloud(ctx), siteCard(ctx))
  return (
    <>
      <g>{all.back}</g>
      <g>{all.edges}</g>
      <g>{all.nodes}</g>
      <g>{all.top}</g>
    </>
  )
}
