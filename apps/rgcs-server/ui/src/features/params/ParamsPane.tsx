import type { ParamProgress, SysId } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { ChangeSet } from './ChangeSet'
import { ParamsTab } from './ParamsTab'
import { useParams } from './useParams'

interface Props {
  readonly sysid: SysId | null
  readonly armed: boolean
  readonly progress: ParamProgress | undefined
  readonly dict: Dict
  readonly hidden: boolean
  readonly onWritten: () => void
}

/** The パラメータ tab: table on the left, change set on the right. Keyed by sysid by its parent. */
export function ParamsPane({ sysid, armed, progress, dict, hidden, onWritten }: Props) {
  const model = useParams(sysid, progress, onWritten)
  return (
    <div className="maint-body params-grid" hidden={hidden}>
      <ParamsTab
        rows={model.rows}
        total={model.entries.size}
        progress={model.progress}
        query={model.query}
        changes={model.changes}
        busy={model.busy}
        dict={dict}
        onQuery={model.setQuery}
        onRefresh={model.refresh}
        onChange={model.change}
      />
      <ChangeSet
        changes={model.changes}
        entries={model.entries}
        meta={model.meta}
        results={model.results}
        armed={armed}
        downloading={model.progress?.downloading === true}
        busy={model.busy}
        error={model.error}
        dict={dict}
        onClear={model.clear}
        onClearAll={model.clearAll}
        onWrite={model.write}
      />
    </div>
  )
}
