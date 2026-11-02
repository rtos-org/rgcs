// Over the mission list: the drawing hint (vertex count, finish / cancel, why it could not finish)
// and the KML input with its chooser.
import type { RefObject } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import type { LatLon } from '../mission/geo'
import { KmlPick } from './KmlPick'
import type { DrawError } from './useSurveyDraw'

interface Props {
  readonly dict: Dict
  readonly drawing: readonly LatLon[] | null
  readonly error: DrawError | null
  readonly onFinish: () => void
  readonly onCancel: () => void
  /** Hides the error, keeping any drawing. */
  readonly onDismiss: () => void
  readonly kmlInput: RefObject<HTMLInputElement | null>
  readonly onKml: (ring: readonly LatLon[], name: string) => void
}

export function SurveySlot({ dict, drawing, error, onFinish, onCancel, onDismiss, kmlInput, onKml }: Props) {
  return (
    <>
      {drawing && (
        <div className="hint sv-draw" data-testid="survey-draw-hint">
          <div>{dict.svDrawHint}</div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <span className="t2 num">{dict.svDrawCount.replace('{n}', String(drawing.length))}</span>
            <div className="grow" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
              {dict.svDrawCancel}
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={drawing.length < 3} onClick={onFinish}>
              {dict.svDrawFinish}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="hint caution sv-draw row" role="alert" style={{ gap: 8 }}>
          <span className="grow">{error === 'too_large' ? dict.svTooLarge : dict.svInvalidPolygon}</span>
          <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onDismiss}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      <KmlPick inputRef={kmlInput} dict={dict} onPolygon={onKml} />
    </>
  )
}
