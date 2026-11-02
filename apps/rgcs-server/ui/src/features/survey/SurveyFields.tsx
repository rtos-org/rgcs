// Survey panel settings after the camera: GSD ⇄ altitude, overlaps, lane
// bearing (slider previews while dragging, commits on release), start, speed / wind, and the
// plane-only turn fields with their 自動 toggles.
import type { Dict } from '../../shared/i18n'
import { NumField, fmtNum } from './NumField'
import { altForGsd, gsdCm } from './photo'
import type { SurveySpec } from './spec'
import type { SurveyMetrics, UpdatePhase } from './useSurvey'

interface Props {
  readonly spec: SurveySpec
  readonly metrics: SurveyMetrics | null
  readonly dict: Dict
  readonly onChange: (patch: Partial<SurveySpec>, phase?: UpdatePhase) => void
}

const STARTS = ['nw', 'ne', 'sw', 'se', 'home'] as const
const TURNS = ['split', 'arc'] as const
const between = (lo: number, hi: number) => (n: number) => n >= lo && n <= hi
const ALT_OK = between(5, 1000)
const PCT_OK = between(0, 95)
const positive = (n: number) => n > 0
const nonNegative = (n: number) => n >= 0
/** Lanes at θ and θ + 180° are the same lanes. */
const fold = (deg: number) => ((Math.round(deg) % 180) + 180) % 180

function Seg<T extends string>({ label, options, value, text, onPick }: { label: string; options: readonly T[]; value: T; text: (o: T) => string; onPick: (o: T) => void }) {
  const at = Math.max(0, options.indexOf(value))
  return (
    <>
      <span>{label}</span>
      <div className={`seg sm${options.length === 5 ? ' n5' : ''}`} role="group" aria-label={label}>
        <span className="lens" style={{ transform: `translateX(${at * 100}%)` }} />
        {options.map((o) => (
          <button key={o} type="button" className={o === value ? 'on' : ''} aria-pressed={o === value} onClick={() => onPick(o)}>
            {text(o)}
          </button>
        ))}
      </div>
    </>
  )
}

function AngleField({ spec, dict, onChange }: Pick<Props, 'spec' | 'dict' | 'onChange'>) {
  const done = () => onChange({}, 'done')
  return (
    <NumField id="sv-angle" label={dict.svAngle} value={fold(spec.angleDeg)} digits={0} valid={Number.isFinite} onCommit={(n) => onChange({ angleDeg: fold(n) })}>
      <input
        type="range"
        className="sv-slider"
        min={0}
        max={179}
        step={1}
        aria-label={dict.svAngle}
        value={fold(spec.angleDeg)}
        onChange={(e) => onChange({ angleDeg: Number(e.target.value) }, 'live')}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
      />
    </NumField>
  )
}

/** Lead-in / overshoot / margin: null = 自動 (the generator's value, shown read-only). */
function AutoField({ id, label, value, auto, dict, onSet }: { id: string; label: string; value: number | null; auto: number; dict: Dict; onSet: (v: number | null) => void }) {
  const isAuto = value === null
  return (
    <NumField id={id} label={label} value={value ?? auto} digits={0} valid={nonNegative} disabled={isAuto} onCommit={onSet}>
      <button type="button" className={`btn btn-sm${isAuto ? ' on' : ''}`} aria-pressed={isAuto} onClick={() => onSet(isAuto ? Math.round(auto) : null)}>
        {dict.svAuto}
      </button>
    </NumField>
  )
}

function TurnFields({ spec, metrics, dict, onChange }: Props) {
  const g = metrics?.geometry
  const roll = metrics?.rollLimitDeg
  return (
    <>
      <NumField id="sv-skip" label={dict.svSkip} value={spec.skip} digits={0} step="1" valid={(n) => Number.isInteger(n) && between(0, 10)(n)} onCommit={(skip) => onChange({ skip })} />
      <Seg label={dict.svTurn} options={TURNS} value={spec.turn} text={(o) => (o === 'split' ? dict.svTurnSplit : dict.svTurnArc)} onPick={(turn) => onChange({ turn })} />
      <NumField id="sv-bank" label={dict.svBank} value={spec.bankDeg} digits={0} valid={between(5, 60)} onCommit={(bankDeg) => onChange({ bankDeg })}>
        {roll !== undefined && <span className="t3 sv-note">{dict.svRollLimit.replace('{n}', fmtNum(roll, 0))}</span>}
      </NumField>
      <AutoField id="sv-lead" label={dict.svLeadIn} value={spec.leadInM} auto={g?.leadInM ?? 0} dict={dict} onSet={(leadInM) => onChange({ leadInM })} />
      <AutoField id="sv-over" label={dict.svOvershoot} value={spec.overshootM} auto={g?.overshootM ?? 0} dict={dict} onSet={(overshootM) => onChange({ overshootM })} />
    </>
  )
}

export function SurveyFields({ spec, metrics, dict, onChange }: Props) {
  const gsd = gsdCm(spec.camera, spec.altM)
  const plane = spec.airframe === 'plane'
  const startText = { nw: dict.svStartNw, ne: dict.svStartNe, sw: dict.svStartSw, se: dict.svStartSe, home: dict.svStartHome }
  return (
    <div className="form sv-form">
      <NumField id="sv-gsd" label={dict.svGsd} value={gsd} digits={2} valid={(n) => n > 0 && ALT_OK(altForGsd(spec.camera, n))} onCommit={(n) => onChange({ altM: altForGsd(spec.camera, n) })} />
      <NumField id="sv-alt" label={dict.svAlt} value={spec.altM} digits={0} valid={ALT_OK} onCommit={(altM) => onChange({ altM })} />
      <NumField id="sv-front" label={dict.svFront} value={spec.frontPct} digits={0} valid={PCT_OK} onCommit={(frontPct) => onChange({ frontPct })} />
      <NumField id="sv-side" label={dict.svSide} value={spec.sidePct} digits={0} valid={PCT_OK} onCommit={(sidePct) => onChange({ sidePct })} />
      <AngleField spec={spec} dict={dict} onChange={onChange} />
      <Seg label={dict.svStart} options={STARTS} value={spec.start} text={(o) => startText[o]} onPick={(start) => onChange({ start })} />
      <NumField id="sv-speed" label={dict.svSpeed} value={spec.speedMs} digits={1} valid={positive} onCommit={(speedMs) => onChange({ speedMs })} />
      <NumField id="sv-wind" label={dict.svWind} value={spec.windMs} digits={1} valid={nonNegative} onCommit={(windMs) => onChange({ windMs })} />
      {plane && <TurnFields spec={spec} metrics={metrics} dict={dict} onChange={onChange} />}
      <AutoField id="sv-margin" label={dict.svMargin} value={spec.marginM} auto={metrics?.geometry.marginAlongM ?? 0} dict={dict} onSet={(marginM) => onChange({ marginM })} />
    </div>
  )
}
