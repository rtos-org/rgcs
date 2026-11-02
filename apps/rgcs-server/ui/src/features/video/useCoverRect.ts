import { useEffect, useState, type RefObject } from 'react'
import { coverRect, type Rect } from './geometry'

/** Without a decoded frame (no video yet) the overlay still maps through a 16:9 picture. */
const FALLBACK: readonly [number, number] = [1920, 1080]

/**
 * The picture's intrinsic size: the decoded `<video>` frame when there is one (it can differ from
 * the 0x20 resolution, e.g. a transcoding relay), else the camera's stream size, else 16:9.
 */
export function pictureSize(video: HTMLVideoElement | null, stream: readonly [number, number] | null): readonly [number, number] {
  if (video && video.videoWidth > 0 && video.videoHeight > 0) return [video.videoWidth, video.videoHeight]
  return stream ?? FALLBACK
}

/** The cover rect of the picture inside `el`, measured now. */
export function measureRect(el: HTMLElement, video: HTMLVideoElement | null, stream: readonly [number, number] | null): Rect | null {
  const [w, h] = pictureSize(video, stream)
  return coverRect(el.clientWidth, el.clientHeight, w, h)
}

interface Size {
  readonly elW: number
  readonly elH: number
  readonly vidW: number
  readonly vidH: number
}

const ZERO: Size = { elW: 0, elH: 0, vidW: 0, vidH: 0 }
const same = (a: Size, b: Size) => a.elW === b.elW && a.elH === b.elH && a.vidW === b.vidW && a.vidH === b.vidH

/** Keeps the overlay's cover rect current through element resizes (ResizeObserver) and new video sizes (`loadedmetadata` / `resize`). */
export function useCoverRect(layerRef: RefObject<HTMLElement | null>, videoRef: RefObject<HTMLVideoElement | null>, live: boolean, stream: readonly [number, number] | null): Rect | null {
  const [size, setSize] = useState<Size>(ZERO)
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return undefined
    const video = live ? videoRef.current : null
    const measure = () => {
      const next = { elW: layer.clientWidth, elH: layer.clientHeight, vidW: video?.videoWidth ?? 0, vidH: video?.videoHeight ?? 0 }
      setSize((prev) => (same(prev, next) ? prev : next))
    }
    const first = setTimeout(measure, 0)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(layer)
    window.addEventListener('resize', measure)
    video?.addEventListener('loadedmetadata', measure)
    video?.addEventListener('resize', measure)
    return () => {
      clearTimeout(first)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      video?.removeEventListener('loadedmetadata', measure)
      video?.removeEventListener('resize', measure)
    }
  }, [layerRef, videoRef, live])
  const [w, h] = size.vidW > 0 && size.vidH > 0 ? [size.vidW, size.vidH] : (stream ?? FALLBACK)
  return coverRect(size.elW, size.elH, w, h)
}
