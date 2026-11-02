import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RoiControl, RoiTarget } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { firstIssue } from '../camera-settings/schema'
import { RoiTab } from './RoiTab'
import { DEFAULT_ROI_CONTROL, emptyTargets, roiControlSchema } from './schema'

const dict = t('ja')
const targets: RoiTarget[] = emptyTargets().map((x, i) =>
  i === 0 ? { ...x, name: '送電塔 A', lat: 35.479883, lon: 138.48829, alt_msl: 412 } : i === 1 ? { ...x, name: '貯水池', lat: 35.469883, lon: 138.47329, alt_msl: 388.4 } : x,
)

type Data = Pick<Parameters<typeof RoiTab>[0], 'targets' | 'control' | 'activeId' | 'targetsIssue' | 'controlIssue' | 'roiMode'>

function renderTab(over: Partial<Data> = {}) {
  const mocks = {
    onTargets: vi.fn<(t: RoiTarget[]) => void>(),
    onControl: vi.fn<(c: RoiControl) => void>(),
    onPickOnMap: vi.fn<() => void>(),
    onCsvError: vi.fn<(msg: string) => void>(),
  }
  const data: Data = { targets, control: DEFAULT_ROI_CONTROL, activeId: null, targetsIssue: null, controlIssue: null, ...over }
  const view = render(<RoiTab {...data} {...mocks} dict={dict} />)
  return { ...mocks, ...view }
}

const csvFile = (bytes: number[]) => new File([new Uint8Array(bytes)], 'roi.csv', { type: 'text/csv' })

describe('RoiTab', () => {
  it('renders 10 rows and marks the active one', () => {
    const { container } = renderTab({ activeId: 'roi_2' })
    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(10)
    expect([...rows].map((r) => r.querySelector('td')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(rows[1]).toHaveClass('on')
    expect(rows[0]).not.toHaveClass('on')
    expect(rows[1]?.textContent).toContain('35.46988')
    expect(rows[1]?.textContent).toContain('138.47329')
    expect(rows[1]?.textContent).toContain('388 m')
    expect(rows[2]?.textContent).not.toContain('0.00000')
  })

  it('editing a name calls onTargets with the new name', () => {
    const { onTargets } = renderTab()
    fireEvent.change(screen.getByLabelText(`${dict.roiName} 2`), { target: { value: '貯水池 B' } })
    const next = onTargets.mock.calls[0]![0]
    expect(next[1]?.name).toBe('貯水池 B')
    expect(next[0]).toBe(targets[0])
    expect(targets[1]?.name).toBe('貯水池')
  })

  it('native ROI hides the control form and shows the ArduPilot note; computed shows the form', () => {
    const { unmount } = renderTab({ roiMode: 'native' })
    expect(screen.queryByRole('group', { name: dict.roiControl })).toBeNull()
    expect(screen.queryByLabelText(dict.roiMaxSpeed)).toBeNull()
    expect(screen.getByText(dict.roiNativeNote)).toBeInTheDocument()
    unmount()
    renderTab({ roiMode: 'computed' })
    expect(screen.getByRole('group', { name: dict.roiControl })).toBeInTheDocument()
    expect(screen.queryByText(dict.roiNativeNote)).toBeNull()
  })

  it('the Follow-mode sentence is MT11-only: native ROI shows the joystick note without it', () => {
    const { unmount } = renderTab({ roiMode: 'native' })
    expect(screen.queryByText(dict.roiNote)).toBeNull()
    expect(screen.getByText(dict.roiNoteNative)).toBeInTheDocument()
    expect(dict.roiNoteNative).not.toContain('Follow')
    unmount()
    renderTab({ roiMode: 'computed' })
    expect(screen.getByText(dict.roiNote)).toBeInTheDocument()
    expect(screen.queryByText(dict.roiNoteNative)).toBeNull()
  })

  it('地図で指定 calls onPickOnMap', () => {
    const { onPickOnMap } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: dict.pickOnMap }))
    expect(onPickOnMap).toHaveBeenCalledTimes(1)
  })

  it('a Shift_JIS CSV file fills the slots', async () => {
    const { onTargets, onCsvError } = renderTab()
    // 名前,lat,lon,alt / 送電塔,36.1,139.1,400 in Shift_JIS
    const bytes = [150, 188, 145, 79, 44, 108, 97, 116, 44, 108, 111, 110, 44, 97, 108, 116, 10, 145, 151, 147, 100, 147, 131, 44, 51, 54, 46, 49, 44, 49, 51, 57, 46, 49, 44, 52, 48, 48, 10]
    fireEvent.change(screen.getByLabelText(dict.roiCsvFile), { target: { files: [csvFile(bytes)] } })
    await waitFor(() => expect(onTargets).toHaveBeenCalledTimes(1))
    const next = onTargets.mock.calls[0]![0]
    expect(next[0]).toEqual({ id: 'roi_1', name: '送電塔', lat: 36.1, lon: 139.1, alt_msl: 400 })
    expect(next[1]?.name).toBe('')
    expect(onCsvError).not.toHaveBeenCalled()
  })

  it('a bad CSV reports the translated line and reason and keeps the targets', async () => {
    const { onTargets, onCsvError } = renderTab()
    const bytes = [...new TextEncoder().encode('名前,lat,lon,alt\nA,35,139,0\nB,91,139,0\n')]
    fireEvent.change(screen.getByLabelText(dict.roiCsvFile), { target: { files: [csvFile(bytes)] } })
    await waitFor(() => expect(onCsvError).toHaveBeenCalledTimes(1))
    expect(onCsvError).toHaveBeenCalledWith(dict.roiCsvError.replace('{line}', '3').replace('{reason}', dict.roiCsvReason_lat))
    expect(onTargets).not.toHaveBeenCalled()
  })

  it('the rate / angle seg toggles control_mode', () => {
    const { onControl } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: '角度制御' }))
    expect(onControl).toHaveBeenCalledWith({ ...DEFAULT_ROI_CONTROL, control_mode: 'angle' })
  })

  it('an invalid Kp is marked red', () => {
    const control = { ...DEFAULT_ROI_CONTROL, pid_kp: 99 }
    const { onControl } = renderTab({ control, controlIssue: firstIssue(roiControlSchema.safeParse(control)) })
    expect(screen.getByLabelText('Kp')).toHaveClass('in', 'invalid')
    expect(screen.getByLabelText('Ki')).not.toHaveClass('invalid')
    fireEvent.change(screen.getByLabelText('Ki'), { target: { value: '0.5' } })
    expect(onControl).toHaveBeenCalledWith({ ...control, pid_ki: 0.5 })
  })
})
