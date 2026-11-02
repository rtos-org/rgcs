import { apiFetch } from '../../shared/api/client'
import type { InspectorDetail, InspectorList, InspectorRow } from '../../shared/api/types'

export function fetchInspector(): Promise<InspectorList> {
  return apiFetch<InspectorList>('/api/mavlink/inspector')
}

export function fetchInspectorDetail(r: Pick<InspectorRow, 'dir' | 'sysid' | 'compid' | 'msg_id'>): Promise<InspectorDetail> {
  return apiFetch<InspectorDetail>(`/api/mavlink/inspector/${r.dir}/${r.sysid}/${r.compid}/${r.msg_id}`)
}
