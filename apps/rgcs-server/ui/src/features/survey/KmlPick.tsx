// 「KML から読み込む」: the hidden file input the palette clicks, the inline chooser when the file
// holds several polygons, and the reason a file could not be used (closable).
import { useState, type RefObject } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { readFileText } from '../mission/files'
import type { LatLon } from '../mission/geo'
import { KmlError, parseKmlPolygons, type KmlErrorCode } from './kml'

interface Props {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly dict: Dict
  readonly onPolygon: (ring: readonly LatLon[], name: string) => void
}

/** A polygon offered to the user: an unnamed placemark is named by its place in the file. */
interface Choice {
  readonly name: string
  readonly ring: readonly LatLon[]
}

const ERROR_TEXT: Readonly<Record<KmlErrorCode, keyof Dict>> = {
  not_kml: 'svKmlNotKml',
  no_polygon: 'svKmlNoPolygon',
  bad_coordinates: 'svKmlBadCoordinates',
  too_large: 'svKmlTooLarge',
}

async function readKml(file: File, dict: Dict): Promise<{ choices: Choice[]; holesIgnored: boolean }> {
  try {
    const { polygons, holesIgnored } = parseKmlPolygons(await readFileText(file))
    const choices = polygons.map((p, i) => ({ ring: p.ring, name: p.name ?? dict.svKmlArea.replace('{n}', String(i + 1)) }))
    return { choices, holesIgnored }
  } catch (e) {
    throw e instanceof KmlError ? e : new KmlError('not_kml')
  }
}

/** The file being read: the choices to offer, the holes note and the error. */
function useKmlFile(dict: Dict, onPolygon: Props['onPolygon']) {
  const [choices, setChoices] = useState<readonly Choice[] | null>(null)
  const [holes, setHoles] = useState(false)
  const [error, setError] = useState<KmlErrorCode | null>(null)
  const load = async (file: File) => {
    setChoices(null)
    setHoles(false)
    setError(null)
    try {
      const read = await readKml(file, dict)
      setHoles(read.holesIgnored)
      const only = read.choices.length === 1 ? read.choices[0] : undefined
      if (only) onPolygon(only.ring, only.name)
      else setChoices(read.choices)
    } catch (e) {
      setError(e instanceof KmlError ? e.code : 'not_kml')
    }
  }
  const pick = (c: Choice) => {
    setChoices(null)
    onPolygon(c.ring, c.name)
  }
  return { choices, holes, error, load, pick, dismissChoices: () => setChoices(null), dismissError: () => setError(null) }
}

function KmlChooser({ choices, dict, onPick, onCancel }: { choices: readonly Choice[]; dict: Dict; onPick: (c: Choice) => void; onCancel: () => void }) {
  return (
    <div className="sv-draw sv-kml-choose">
      <div className="row" style={{ gap: 8 }}>
        <span className="t2">{dict.svKmlChoose}</span>
        <div className="grow" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          {dict.svDrawCancel}
        </button>
      </div>
      <div role="list" aria-label={dict.svKmlChoose} className="sv-kml-list">
        {choices.map((c, i) => (
          <div role="listitem" key={`${i}-${c.name}`}>
            <button type="button" className="btn btn-sm sv-kml-item" onClick={() => onPick(c)}>
              <span className="ell">{c.name}</span>
              <span className="t3 num">{dict.svDrawCount.replace('{n}', String(c.ring.length))}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function KmlPick({ inputRef, dict, onPolygon }: Props) {
  const kml = useKmlFile(dict, onPolygon)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".kml,application/vnd.google-earth.kml+xml"
        style={{ display: 'none' }}
        data-testid="survey-kml-file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void kml.load(file)
        }}
      />
      {kml.error && (
        <div className="hint caution sv-draw row" style={{ gap: 8 }}>
          <span className="grow" role="alert">
            {dict[ERROR_TEXT[kml.error]]}
          </span>
          <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={kml.dismissError}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      {kml.holes && <div className="hint sv-draw t3">{dict.svKmlHoles}</div>}
      {kml.choices && <KmlChooser choices={kml.choices} dict={dict} onPick={kml.pick} onCancel={kml.dismissChoices} />}
    </>
  )
}
