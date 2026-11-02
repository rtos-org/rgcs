import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { AiAck, CameraCommand, CameraSnapshot } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { vehicleStore } from '../vehicles/store'
import { clickAction } from './clickAction'
import { knownStream, previewBox, toNormalized, type Rect } from './geometry'
import { measureRect, pictureSize } from './useCoverRect'

/** How long the dashed preview box waits for the first 0x50. */
export const PREVIEW_MS = 1500

function logFailure(sysid: number, cmd: 'ai_track' | 'measure_point', reason: string): void {
  vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd, ok: false, reason, ts: Date.now() })
}

interface Deps {
  readonly sysid: number
  readonly camera: CameraSnapshot | undefined
  readonly boxPx: number
  readonly dict: Dict
  readonly onCommand: (cmd: CameraCommand) => void
  readonly videoRef: RefObject<HTMLVideoElement | null>
}

/**
 * Cockpit video clicks: maps the click through the cover rect measured at that
 * moment, sends the command or logs the refusal, and keeps the preview box for a box select.
 */
export function useOverlayClicks({ sysid, camera, boxPx, dict, onCommand, videoRef }: Deps) {
  const [preview, setPreview] = useState<Rect | null>(null)
  useEffect(() => {
    if (!preview) return undefined
    const id = setTimeout(() => setPreview(null), PREVIEW_MS)
    return () => clearTimeout(id)
  }, [preview])
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!camera) return
    const layer = e.currentTarget
    const b = layer.getBoundingClientRect()
    const rect = measureRect(layer, videoRef.current, knownStream(camera.state.stream))
    const n = toNormalized(e.clientX - b.left, e.clientY - b.top, rect)
    if (!n || !rect) return
    const result = clickAction({ ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }, n.nx, n.ny, camera.state, camera.caps, boxPx)
    if (!result) return
    if (result.kind === 'refuse') {
      logFailure(sysid, e.altKey ? 'measure_point' : 'ai_track', dict[`camErr_${result.code}`])
      return
    }
    if (result.cmd.cmd === 'ai_select_box') {
      const [sw, sh] = knownStream(camera.state.stream) ?? pictureSize(null, null)
      setPreview(previewBox(n.nx, n.ny, rect, sw, sh, boxPx))
    }
    onCommand(result.cmd)
  }
  return { preview, onClick }
}

/** A failed 0x55 / 0x56 ACK (a new `seq` with a code other than ok) goes to the log once. */
export function useAiAckLog(sysid: number, ack: AiAck | null | undefined, dict: Dict): void {
  const seen = useRef(ack?.seq ?? null)
  useEffect(() => {
    if (!ack || ack.seq === seen.current) return
    seen.current = ack.seq
    if (ack.code === 'ok') return
    const key = `aiAck_${ack.code}` as keyof Dict
    logFailure(sysid, 'ai_track', (dict[key] as string | undefined) ?? dict.aiAck_unknown)
  }, [sysid, ack, dict])
}
