import { z } from 'zod'

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** The MT11 default; a MAVLink camera needs a literal URL. */
export const MT11_RTSP_URL = 'rtsp://{host}:8554/video1'

/** The host of an `rtsp://` URL when it is an IPv4 literal (no userinfo), else null. */
export function hostFromRtsp(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'rtsp:' || u.username !== '' || u.password !== '') return null
    return IPV4.test(u.hostname) ? u.hostname : null
  } catch {
    return null
  }
}

/**
 * The 接続 tab's editable subset of `CameraProfile`. A MAVLink camera's
 * RTSP host must be the profile host (60 §5): the tab derives `host` from the URL.
 */
export const cameraProfileSchema = z
  .object({
    kind: z.enum(['none', 'mavlink', 'siyi_mt11']),
    host: z.string().regex(IPV4, 'IPv4'),
    port: z.number().int().min(1).max(65535),
    video_source_mode: z.enum(['auto', 'mt11']).default('auto'),
    rtsp_url: z.string().default(MT11_RTSP_URL),
    comp_id: z.number().int().min(1).max(255).default(100),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'mavlink' && hostFromRtsp(d.rtsp_url) !== d.host) ctx.addIssue({ code: 'custom', path: ['rtsp_url'], message: 'rtsp://<IPv4>/…' })
  })

export type CameraProfileDraft = z.infer<typeof cameraProfileSchema>

export interface Issue {
  readonly path: string
  readonly message: string
}

type ParseLike = { readonly success: true } | { readonly success: false; readonly error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] } }

export function firstIssue(r: ParseLike): Issue | null {
  if (r.success) return null
  const issue = r.error.issues[0]
  return issue ? { path: issue.path.map(String).join('.'), message: issue.message } : null
}
