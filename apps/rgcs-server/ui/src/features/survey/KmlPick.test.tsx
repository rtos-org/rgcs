import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { KmlPick } from './KmlPick'

const dict = t('ja')
const placemark = (name: string, lat: number) =>
  `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>139,${lat} 139.01,${lat} 139.01,${lat + 0.01} 139,${lat}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
const kml = (...marks: string[]) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${marks.join('')}</Document></kml>`

const unnamed = (lat: number) => placemark('', lat).replace('<name></name>', '')

async function pick(text: string, d = dict) {
  const onPolygon = vi.fn()
  const input = createRef<HTMLInputElement>()
  render(<KmlPick inputRef={input} dict={d} onPolygon={onPolygon} />)
  await act(async () => {
    fireEvent.change(screen.getByTestId('survey-kml-file'), { target: { files: [new File([text], 'area.kml')] } })
  })
  return { onPolygon, input }
}

describe('KmlPick', () => {
  it('the hidden input takes .kml files and is reachable through the ref', async () => {
    const { input } = await pick(kml(placemark('A', 36)))
    expect(input.current).toBe(screen.getByTestId('survey-kml-file'))
    expect(input.current?.accept).toContain('.kml')
  })

  it('a file with one polygon is used at once', async () => {
    const { onPolygon } = await pick(kml(placemark('A', 36)))
    expect(onPolygon).toHaveBeenCalledWith(
      [
        { lat: 36, lon: 139 },
        { lat: 36, lon: 139.01 },
        { lat: 36.01, lon: 139.01 },
      ],
      'A',
    )
  })

  it('two polygons: an inline list asks which one', async () => {
    const { onPolygon } = await pick(kml(placemark('North', 36), placemark('South', 35)))
    expect(onPolygon).not.toHaveBeenCalled()
    const list = screen.getByRole('list', { name: dict.svKmlChoose })
    expect(list.textContent).toContain('North')
    fireEvent.click(screen.getByRole('button', { name: /South/ }))
    expect(onPolygon).toHaveBeenCalledWith(expect.arrayContaining([{ lat: 35, lon: 139 }]), 'South')
    expect(screen.queryByRole('list', { name: dict.svKmlChoose })).toBeNull()
  })

  it('the chooser can be dismissed without a survey', async () => {
    const { onPolygon } = await pick(kml(placemark('North', 36), placemark('South', 35)))
    fireEvent.click(screen.getByRole('button', { name: dict.svDrawCancel }))
    expect(onPolygon).not.toHaveBeenCalled()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows the error for the code: not KML', async () => {
    await pick('not xml at all')
    expect(screen.getByRole('alert').textContent).toBe(dict.svKmlNotKml)
  })

  it('shows the error for the code: no polygon', async () => {
    const { onPolygon } = await pick(kml())
    expect(screen.getByRole('alert').textContent).toBe(dict.svKmlNoPolygon)
    expect(onPolygon).not.toHaveBeenCalled()
  })

  it('the error hint can be closed', async () => {
    await pick('not xml at all')
    fireEvent.click(screen.getByRole('button', { name: dict.close }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an unnamed polygon is named from the dictionary by its place in the file', async () => {
    const en = t('en')
    const { onPolygon } = await pick(kml(placemark('North', 36), unnamed(35)), en)
    fireEvent.click(screen.getByRole('button', { name: /Area 2/ }))
    expect(onPolygon).toHaveBeenCalledWith(expect.anything(), 'Area 2')
  })
})
