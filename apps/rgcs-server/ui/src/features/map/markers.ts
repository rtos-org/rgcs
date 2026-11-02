import type { CameraSnapshot, VehicleState } from '../../shared/api/types'
import { bearingOf, fanPath, fanLengthPx, hfovAt, isNadir } from './gimbal'

/** A 2D+ fix and not the null island: the only positions worth drawing (Review Focus 2). */
export function hasPosition(v: VehicleState): boolean {
  return v.gps.fix >= 2 && !(v.lat === 0 && v.lon === 0)
}

// Markers are plain DOM for MapLibre, so the icons are inline SVG with the same paths as
// `shared/ui/icons` (Lucide 1.51 `car` / `plane` / `house`, the prototype's `#i-drone`).
const svg = (size: number, body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const DRONE =
  '<path d="M10 10 7 7"/><path d="m14 10 3-3"/><path d="m14 14 3 3"/><path d="m10 14-3 3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/><circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="18.5" r="3"/>'
const CAR =
  '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>'
const PLANE =
  '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'
/** Lucide `plane` points its nose up-right. */
const PLANE_NOSE_DEG = 45
const HOUSE =
  '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'

/** Prototype CAM_HFOV for cameras that do not report one. */
export const DEFAULT_HFOV_DEG = 62

/** Where the camera looks, for the fan: bearing over ground, current horizontal FOV, pitch. */
export interface GimbalPose {
  readonly bearing: number
  readonly hfov: number
  readonly pitch: number
}

/** A pose only when the camera reports gimbal attitude and has one, and the vehicle has a heading. */
export function gimbalPose(v: VehicleState, cam: CameraSnapshot | undefined): GimbalPose | null {
  const att = cam?.state.gimbal
  if (!cam?.caps.gimbal?.attitude || !att || v.hdg === null) return null
  // a percent zoom has no known multiplier: the fan stays at the 1× field of view
  const zoom = cam.caps.zoom?.unit === 'percent' ? 1 : cam.state.zoom || 1
  return { bearing: bearingOf(v.hdg, att.yaw), hfov: hfovAt(cam.caps.hfov_deg ?? DEFAULT_HFOV_DEG, zoom), pitch: att.pitch }
}

const fovSvg = (sysid: number) =>
  `<svg class="fov" viewBox="0 0 240 240" style="display:none"><defs><radialGradient id="fovg-${sysid}" gradientUnits="userSpaceOnUse" cx="120" cy="120" r="100"><stop offset="0" stop-color="#5fd39b" stop-opacity=".7"/><stop offset="1" stop-color="#5fd39b" stop-opacity=".14"/></radialGradient></defs><path class="cone" fill="url(#fovg-${sysid})"/><circle class="nadir" cx="120" cy="120" r="26"/></svg>`

/** Shows / poses the `.fov` fan (prototype poseMarkers); hidden without a pose. */
function poseFan(el: HTMLElement, pose: GimbalPose | null): void {
  const fov = el.querySelector<SVGElement>('.fov')
  if (!fov) return
  fov.style.display = pose ? '' : 'none'
  if (!pose) return
  const nadir = isNadir(pose.pitch)
  const cone = fov.querySelector<SVGElement>('.cone')
  cone?.style.setProperty('display', nadir ? 'none' : '')
  cone?.setAttribute('d', fanPath(pose.hfov, pose.pitch))
  fov.querySelector('radialGradient')?.setAttribute('r', String(fanLengthPx(pose.pitch)))
  fov.querySelector<SVGElement>('.nadir')?.style.setProperty('display', nadir ? '' : 'none')
  fov.style.transform = `rotate(${pose.bearing}deg)`
}

/** Toggles our classes only; MapLibre owns `maplibregl-marker` on the same element. */
function applyClasses(el: HTMLElement, v: VehicleState, selected: boolean): void {
  el.classList.add('rg-mk')
  el.classList.toggle('sel', selected)
  el.classList.toggle('warn', v.warn || v.link !== 'ok')
}

/** The prototype's vehicle marker: `.vmk` (heading caret on `.arrow`, type icon on `.disc`) + name pill. */
export function markerEl(v: VehicleState, selected: boolean, pose: GimbalPose | null = null): HTMLDivElement {
  const el = document.createElement('div')
  const kind = v.kind === 'rover' || v.kind === 'plane' ? v.kind : 'copter'
  el.innerHTML =
    `<div class="vmk ${kind}">${fovSvg(v.sysid)}<i class="beacon"></i><div class="arrow"><i class="hd"></i></div><div class="disc">${svg(18, kind === 'rover' ? CAR : kind === 'plane' ? PLANE : DRONE)}</div><i class="lock"></i></div>` +
    '<div><div class="lbl"></div><div class="alt" style="display:none"></div></div>'
  return updateMarkerEl(el, v, selected, pose)
}

/** Updates classes, the caret's rotation, the gimbal fan and texts in place (no element churn at 10 Hz). */
export function updateMarkerEl(el: HTMLDivElement, v: VehicleState, selected: boolean, pose: GimbalPose | null = null): HTMLDivElement {
  applyClasses(el, v, selected)
  poseFan(el, pose)
  el.title = v.name
  const arrow = el.querySelector<HTMLElement>('.arrow')
  if (arrow) arrow.style.transform = `rotate(${v.hdg ?? 0}deg)`
  // the plane is drawn from above: its nose follows the heading (Lucide's points to 45°)
  const ic = el.querySelector<SVGElement>('.vmk.plane .disc .ic')
  if (ic) ic.style.transform = `rotate(${(v.hdg ?? 0) - PLANE_NOSE_DEG}deg)`
  const lbl = el.querySelector('.lbl')
  if (lbl) lbl.textContent = v.name
  const alt = el.querySelector('.alt')
  if (alt) alt.textContent = `${Math.round(v.alt_rel)} m`
  return el
}

/** The prototype's `.rg-home`: a white tile with a house, its own marker at the vehicle's home; `title` says whose. */
export function homeEl(title: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'rg-home'
  el.title = title
  el.innerHTML = svg(15, HOUSE)
  return el
}
