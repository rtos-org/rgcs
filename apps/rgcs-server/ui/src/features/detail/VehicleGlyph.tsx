import type { ModelKey } from '../map/models/meshes'

/** Top view, nose up (−y), about ±16 units: the vehicle at the middle of the compass. */
const PLANE = 'M 0 -16 L 3 -6 L 14 2 V 5 L 3 2 L 2 10 L 6 14 V 16 L 0 14 L -6 16 V 14 L -2 10 L -3 2 L -14 5 V 2 L -3 -6 Z'
const CORNERS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]

function Rotors({ at }: { readonly at: readonly (readonly [number, number])[] }) {
  return at.map(([x, y]) => <circle key={`${x},${y}`} data-part="rotor" className="rotor" cx={x} cy={y} r={4.5} />)
}

function Copter() {
  const tips = CORNERS.map(([x, y]) => [x * 10, y * 10] as const)
  return (
    <>
      <path className="arm" d={tips.map(([x, y]) => `M 0 0 L ${x} ${y}`).join(' ')} />
      <Rotors at={tips} />
      <rect x={-4.5} y={-4.5} width={9} height={9} rx={2} />
      <path d="M 0 -10 L 3 -5 H -3 Z" />
    </>
  )
}

function QuadPlane() {
  const tips = CORNERS.map(([x, y]) => [x * 9, y * 9 - 1] as const)
  return (
    <>
      <path className="arm" d="M -9 -10 V 8 M 9 -10 V 8" />
      <path d={PLANE} />
      <Rotors at={tips} />
    </>
  )
}

function Rover() {
  return (
    <>
      {CORNERS.map(([x, y]) => (
        <rect key={`${x},${y}`} data-part="wheel" x={x * 9.5 - 2} y={y * 7.5 - 4} width={4} height={8} rx={1} />
      ))}
      <rect x={-7} y={-12} width={14} height={24} rx={3} />
      <path className="nose" d="M 0 -9 L 3.5 -4 H -3.5 Z" />
    </>
  )
}

/** The compass's vehicle in the shape of its airframe (same choice as the 3D model). */
export function VehicleGlyph({ frame }: { readonly frame: ModelKey }) {
  return (
    <g data-part="vehicle" data-frame={frame} className="aircraft">
      {frame === 'copter' ? <Copter /> : frame === 'quadplane' ? <QuadPlane /> : frame === 'rover' ? <Rover /> : <path d={PLANE} />}
    </g>
  )
}
