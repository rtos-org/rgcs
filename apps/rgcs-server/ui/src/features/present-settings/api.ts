import { CSRF_HEADER, CSRF_VALUE, apiFetch } from '../../shared/api/client'

export interface PresentationToken {
  readonly token_prefix: string
  readonly label: string
  readonly created_by: string
  readonly created_at: string
  readonly revoked_at: string | null
}

export const listTokens = () => apiFetch<PresentationToken[]>('/api/settings/presentation/tokens')
export const createToken = (label: string) => apiFetch<{ token: string; url: string }>('/api/settings/presentation/tokens', { method: 'POST', body: { label } })
export const revokeToken = (prefix: string) => apiFetch<null>(`/api/settings/presentation/tokens/${prefix}`, { method: 'DELETE' })
export const deleteLogo = () => apiFetch<null>('/api/settings/branding/logo', { method: 'DELETE' })

/** Raw upload: the body is the file itself, typed by its MIME type (png or svg). */
export async function uploadLogo(file: File): Promise<void> {
  const res = await fetch('/api/settings/branding/logo', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { [CSRF_HEADER]: CSRF_VALUE, 'content-type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
}
