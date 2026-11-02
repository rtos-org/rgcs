import type { RoiControl, RoiControlMode } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { Issue } from '../camera-settings/schema'

interface Props {
  readonly control: RoiControl
  readonly issue: Issue | null
  readonly onChange: (next: RoiControl) => void
  readonly dict: Dict
}

type NumKey = 'pid_kp' | 'pid_ki' | 'pid_kd' | 'deadband_deg' | 'smoothing_tau_s' | 'max_speed' | 'yaw_offset_deg'

const MODES: readonly RoiControlMode[] = ['rate', 'angle']

/** Prototype ROI tab, lower block: 制御方式 seg (rate / angle) and the PID / limits grid. */
export function RoiControlForm({ control, issue, onChange, dict }: Props) {
  const field = (label: string, key: NumKey) => (
    <>
      <span>{label}</span>
      <input
        type="number"
        step="any"
        className={issue?.path === key ? 'in num invalid' : 'in num'}
        aria-label={label}
        value={control[key]}
        onChange={(e) => onChange({ ...control, [key]: Number(e.target.value) })}
      />
    </>
  )
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="ttl">{dict.roiControl}</span>
        <div className="grow" />
        <div className="seg sm" role="group" aria-label={dict.roiControl} style={{ width: 150 }}>
          <span className="lens" style={{ transform: `translateX(${MODES.indexOf(control.control_mode) * 100}%)` }} />
          {MODES.map((m) => (
            <button key={m} type="button" className={control.control_mode === m ? 'on' : ''} onClick={() => onChange({ ...control, control_mode: m })}>
              {m === 'rate' ? dict.roiModeRate : dict.roiModeAngle}
            </button>
          ))}
        </div>
      </div>
      <div className="form wide" style={{ fontSize: 12 }}>
        {field('Kp', 'pid_kp')}
        {field('Ki', 'pid_ki')}
        {field('Kd', 'pid_kd')}
        {field(dict.roiDeadband, 'deadband_deg')}
        {field(dict.roiSmoothing, 'smoothing_tau_s')}
        {field(dict.roiMaxSpeed, 'max_speed')}
        {field(dict.roiYawOffset, 'yaw_offset_deg')}
      </div>
      <div className="t3" style={{ fontSize: 11, marginTop: 8 }}>
        {dict.roiCtrlNote}
      </div>
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </div>
  )
}
