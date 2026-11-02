// PDF / CSV links for the current form and period (cookie-authenticated GET, `download`).
import type { Dict } from '../../shared/i18n'
import { exportUrl, type FormNumber } from './api'

interface Props {
  readonly sysid: number
  readonly form: FormNumber
  readonly from: string
  readonly to: string
  readonly dict: Dict
}

export function ExportBar({ sysid, form, from, to, dict }: Props) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <a className="btn" href={exportUrl(sysid, form, from, to, 'pdf')} download>
        {dict.lbExportPdf}
      </a>
      <a className="btn" href={exportUrl(sysid, form, from, to, 'csv')} download>
        {dict.lbExportCsv}
      </a>
    </div>
  )
}
