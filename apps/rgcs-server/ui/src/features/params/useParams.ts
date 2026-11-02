// Loads the list + metadata for one vehicle, keeps the change set, runs refresh and the
// confirmed write. Mounted per vehicle (the pane is keyed by sysid), so no reset logic here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ParamEntry, ParamProgress, ParamWriteResult, SysId } from '../../shared/api/types'
import { requestConfirm } from '../commands/api'
import { getParams, refreshParams, writeParams, type ParamsReply } from './api'
import { EMPTY_CHANGES, clearChange, pending, setChange, type Changes } from './changes'
import { loadMeta, type MetaMap } from './meta'
import { rank, type ParamRow } from './search'

export const CONFIRM_CMD = 'param_write'

export interface ParamsModel {
  readonly entries: ReadonlyMap<string, ParamEntry>
  readonly rows: readonly ParamRow[]
  readonly meta: MetaMap
  readonly progress: ParamProgress | null
  readonly query: string
  readonly changes: Changes
  readonly results: readonly ParamWriteResult[] | null
  readonly busy: boolean
  readonly error: string | null
  readonly setQuery: (q: string) => void
  readonly refresh: () => void
  readonly change: (name: string, value: number) => void
  readonly clear: (name: string) => void
  readonly clearAll: () => void
  readonly write: () => Promise<void>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Fetches the list; the returned function cancels delivery (effect cleanup). */
function fetchInto(sysid: SysId, apply: (r: ParamsReply) => void, onError: (m: string) => void): () => void {
  let live = true
  getParams(sysid)
    .then((r) => live && apply(r))
    .catch((e: unknown) => live && onError(message(e)))
  return () => {
    live = false
  }
}

export function useParams(sysid: SysId | null, wsProgress: ParamProgress | undefined, onWritten?: () => void): ParamsModel {
  const [entries, setEntries] = useState<ReadonlyMap<string, ParamEntry>>(new Map())
  const [fetched, setFetched] = useState<ParamProgress | null>(null)
  const [meta, setMeta] = useState<MetaMap>({})
  const [query, setQuery] = useState('')
  const [changes, setChanges] = useState<Changes>(EMPTY_CHANGES)
  const [results, setResults] = useState<readonly ParamWriteResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadMeta().then(setMeta)
  }, [])

  const apply = useCallback((reply: ParamsReply) => {
    setEntries(new Map(reply.entries.map((e) => [e.name, e])))
    setFetched(reply.progress)
    setError(null)
  }, [])

  useEffect(() => (sysid === null ? undefined : fetchInto(sysid, apply, setError)), [sysid, apply])

  // The server pushes progress; when a download completes, pull the entries once more.
  const progress = wsProgress ?? fetched
  const complete = wsProgress?.complete === true && wsProgress.downloading === false
  useEffect(() => (complete && sysid !== null ? fetchInto(sysid, apply, setError) : undefined), [complete, sysid, apply])

  const rows = useMemo(() => rank([...entries.values()], meta, query), [entries, meta, query])

  const refresh = useCallback(() => {
    if (sysid === null) return
    setBusy(true)
    refreshParams(sysid)
      .then((p) => setFetched(p))
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }, [sysid])

  const change = useCallback((name: string, value: number) => setChanges((c) => setChange(c, name, value, entries)), [entries])
  const clear = useCallback((name: string) => setChanges((c) => clearChange(c, name)), [])
  const clearAll = useCallback(() => setChanges(EMPTY_CHANGES), [])

  const write = useCallback(async () => {
    if (sysid === null || changes.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const { confirm_token } = await requestConfirm(sysid, CONFIRM_CMD)
      const written = await writeParams(sysid, pending(changes), confirm_token)
      setResults(written)
      setChanges(EMPTY_CHANGES)
      onWritten?.()
      apply(await getParams(sysid))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }, [sysid, changes, apply, onWritten])

  return { entries, rows, meta, progress, query, changes, results, busy, error, setQuery, refresh, change, clear, clearAll, write }
}
