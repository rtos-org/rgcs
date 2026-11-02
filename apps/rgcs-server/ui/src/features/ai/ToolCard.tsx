// The tool card under a bot reply: the last vehicle status the AI
// read (最終受信 / 映像) and every tool it ran for the reply.
import type { AiStatusCard, AiToolRun, AiVideoState } from '../../shared/api/types'
import { hhmm } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconError, IconOk } from '../../shared/ui/icons'
import { ageText, toolLabel } from './format'

const VIDEO_TEXT: Readonly<Record<AiVideoState, keyof Dict>> = {
  live: 'aiVideoLive',
  checking: 'aiVideoChecking',
  down: 'aiVideoDown',
  none: 'aiVideoNone',
}

interface Props {
  readonly card: AiStatusCard | null
  readonly runs: readonly AiToolRun[]
  readonly names: ReadonlyMap<number, string>
  readonly dict: Dict
}

function RunRow({ run, names, dict }: { run: AiToolRun; names: ReadonlyMap<number, string>; dict: Dict }) {
  return (
    <div className="ai-run">
      <div className="row">
        <span className={`ai-run-ic ${run.ok ? 'ok' : 'bad'}`}>{run.ok ? <IconOk /> : <IconError />}</span>
        <span>{toolLabel(run.tool, run.ok, dict)}</span>
        <span className="t4 num ai-time ai-run-time">{hhmm(run.ts)}</span>
      </div>
      {run.sysid !== null && (
        <div className="t3 ai-run-target">
          {dict.aiTarget}: {names.get(run.sysid) ?? `#${run.sysid}`}
        </div>
      )}
    </div>
  )
}

export function ToolCard({ card, runs, names, dict }: Props) {
  return (
    <div className="inset ai-tool">
      {card && (
        <div className="num ai-kv">
          <span className="t2">{dict.aiLastRx}</span>
          <span>{ageText(card.last_rx_age_ms, dict)}</span>
          <span className="t2">{dict.aiVideo}</span>
          <span>{dict[VIDEO_TEXT[card.video]]}</span>
        </div>
      )}
      <div className="t3 ai-tool-h">{dict.aiToolHistory}</div>
      {runs.map((run, i) => (
        <RunRow key={i} run={run} names={names} dict={dict} />
      ))}
    </div>
  )
}
