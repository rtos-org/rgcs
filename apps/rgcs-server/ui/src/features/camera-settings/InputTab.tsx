import type { GimbalInputProfile } from '../../shared/api/types'
import { axisFnLabel, buttonFnLabel } from './fnLabels'
import type { Dict } from '../../shared/i18n'
import { AXIS_FUNCTIONS, BUTTON_FUNCTIONS } from '../gimbal-joystick'
import type { Issue } from './schema'

interface Props {
  readonly draft: GimbalInputProfile
  readonly issue: Issue | null
  readonly gamepadIds: readonly string[]
  readonly onChange: (next: GimbalInputProfile) => void
  readonly onCenter: () => void
  readonly dict: Dict
}

const AXES = [0, 1, 2, 3]
const BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7]

/** Prototype 操作 tab: device row, 軸の割当 table, ボタンの割当 table, speed sliders. */
export function InputTab({ draft, issue, gamepadIds, onChange, onCenter, dict }: Props) {
  const axis = (i: number) => draft.axes.find((a) => a.axis === i) ?? { axis: i, fn: 'none' as const, deadzone: 0.08, invert: false, scale: 1 }
  const setAxis = (i: number, patch: Partial<GimbalInputProfile['axes'][number]>) => {
    const next = { ...axis(i), ...patch }
    onChange({ ...draft, axes: [...draft.axes.filter((a) => a.axis !== i), next].sort((a, b) => a.axis - b.axis) })
  }
  const button = (i: number) => draft.buttons.find((b) => b.button === i)?.fn ?? 'none'
  const setButton = (i: number, fn: GimbalInputProfile['buttons'][number]['fn']) =>
    onChange({ ...draft, buttons: [...draft.buttons.filter((b) => b.button !== i), { button: i, fn }].sort((a, b) => a.button - b.button) })
  const bad = (field: string) => (issue?.path === field ? 'in num invalid' : 'in num')
  const speed = (label: string, key: 'max_pan_speed' | 'max_tilt_speed') => (
    <>
      <span>{label}</span>
      <div className="row" style={{ gap: 10 }}>
        <input type="range" min={1} max={100} value={draft[key]} aria-hidden="true" tabIndex={-1} style={{ flex: 1 }} onChange={(e) => onChange({ ...draft, [key]: Number(e.target.value) })} />
        <input type="number" className={bad(key)} aria-label={label} style={{ width: 70 }} value={draft[key]} onChange={(e) => onChange({ ...draft, [key]: Number(e.target.value) })} />
      </div>
    </>
  )
  return (
    <>
      <div className="form">
        <span>{dict.gamepadDevice}</span>
        <select id="js-device" className="in" aria-label={dict.gamepadDevice} value={draft.device_id ?? ''} onChange={(e) => onChange({ ...draft, device_id: e.target.value || null })}>
          <option value="">{dict.auto}</option>
          {gamepadIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="ttl" style={{ marginBottom: 6 }}>
          {dict.axesTitle}
        </div>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>{dict.axis}</th>
              <th>{dict.function}</th>
              <th>{dict.deadzone}</th>
              <th>{dict.invert}</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((i) => (
              <tr key={i}>
                <td className="mono t2">{i}</td>
                <td>
                  <select className="in" aria-label={dict.axisFunction.replace('{n}', String(i))} value={axis(i).fn} onChange={(e) => setAxis(i, { fn: e.target.value as (typeof AXIS_FUNCTIONS)[number] })}>
                    {AXIS_FUNCTIONS.map((f) => (
                      <option key={f} value={f}>
                        {axisFnLabel(f, dict)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="number" step="0.01" className={bad(`axes.${i}.deadzone`)} style={{ width: 64 }} aria-label={`${dict.deadzone} ${i}`} value={axis(i).deadzone} onChange={(e) => setAxis(i, { deadzone: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${dict.invert} ${i}`} checked={axis(i).invert} onChange={(e) => setAxis(i, { invert: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="ttl" style={{ marginBottom: 6 }}>
          {dict.buttonsTitle}
        </div>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>{dict.button}</th>
              <th>{dict.function}</th>
            </tr>
          </thead>
          <tbody>
            {BUTTONS.map((i) => (
              <tr key={i}>
                <td className="mono t2">{i}</td>
                <td>
                  <select className="in" aria-label={dict.buttonFunction.replace('{n}', String(i))} value={button(i)} onChange={(e) => setButton(i, e.target.value as (typeof BUTTON_FUNCTIONS)[number])}>
                    {BUTTON_FUNCTIONS.map((f) => (
                      <option key={f} value={f}>
                        {buttonFnLabel(f, dict)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form">
        {speed(dict.maxPanSpeed, 'max_pan_speed')}
        {speed(dict.maxTiltSpeed, 'max_tilt_speed')}
      </div>
      <button type="button" className="btn" onClick={onCenter}>
        {dict.centerGimbal}
      </button>
      {issue && <span className="danger settings-issue">{issue.path}: {issue.message}</span>}
    </>
  )
}
