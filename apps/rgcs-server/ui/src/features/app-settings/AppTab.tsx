// アプリ設定 tab: 表示言語, 表示 (theme), 地図表示, プラグイン, 機体台帳, 操縦者, 点検テンプレート, the
// 実験機能 / 外的要因データ cards and the
// 観客用画面 card opening the links and logo sheet. Card grid after the prototype's app tab.
import type { Operator, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { LangSwitch } from '../../shared/ui/LangSwitch'
import { IconCloudSun, IconFlask } from '../../shared/ui/icons'
import { DisplayCard } from './DisplayCard'
import { LaunchCard } from './LaunchCard'
import { MapDisplayCard } from './MapDisplayCard'
import { MavlinkCard } from './MavlinkCard'
import { PilotForm } from './PilotForm'
import { PluginsCard } from './PluginsCard'
import { RegistryForm } from './RegistryForm'
import { TemplateEditor } from './TemplateEditor'

interface Props {
  readonly sysid: number | null
  readonly vehicle: VehicleState | undefined
  readonly me: Operator
  readonly dict: Dict
  readonly onOpenPresent: () => void
  readonly onOpenGuard: () => void
  readonly onOpenEnv: () => void
}

export function AppTab({ sysid, vehicle, me, dict, onOpenPresent, onOpenGuard, onOpenEnv }: Props) {
  const isAdmin = me.role === 'admin'
  return (
    <div className="maint-body lb-cards">
      <div className="surface">
        <div className="h1">{dict.lbLanguage}</div>
        <LangSwitch variant="seg" />
      </div>
      <div className="surface" data-testid="present-card">
        <div className="h1">{dict.presentTitle}</div>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onOpenPresent}>
          {dict.lbPresentSettings}
        </button>
      </div>
      <DisplayCard dict={dict} />
      <MapDisplayCard dict={dict} />
      <MavlinkCard dict={dict} isAdmin={isAdmin} />
      <PluginsCard dict={dict} isAdmin={isAdmin} />
      <LaunchCard testId="guard-card" icon={<IconFlask />} title={dict.guardCardTitle} note={dict.guardCardNote} dict={dict} onOpen={onOpenGuard} />
      <LaunchCard testId="env-card" icon={<IconCloudSun />} title={dict.envCardTitle} note={dict.envCardNote} dict={dict} onOpen={onOpenEnv} />
      {sysid !== null && <RegistryForm key={sysid} sysid={sysid} vehicle={vehicle} isAdmin={isAdmin} dict={dict} />}
      <PilotForm dict={dict} />
      <TemplateEditor dict={dict} isAdmin={isAdmin} />
    </div>
  )
}
