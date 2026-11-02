// Korean UI strings, one file per dictionary module (same names as ../*.ts). Keys missing here
// fall back to English at runtime; lang.test.ts requires every key to be translated.
import type { Dict } from '../index'
import { baseKo } from './base'
import { logbookKo } from './logbook'
import { opsToolsKo } from './opsTools'
import { p9Ko } from './p9'
import { edit3dKo } from './edit3d'
import { planKo } from './plan'
import { videoKo } from './video'
import { calibKo } from './calib'
import { plansKo } from './plans'
import { planeCmdKo } from './plane'
import { plannerKo } from './planner'
import { surveyKo } from './survey'
import { instrumentsKo } from './instruments'
import { wpGoKo } from './wpGo'
import { inspRateKo } from './inspRate'
import { roiKo } from './roi'
import { cameraMediaKo } from './cameraMedia'
import { mavlinkCameraKo } from './mavlinkCamera'
import { cameraVideoKo } from './cameraVideo'
import { missionItemsKo } from './missionItems'
import { networkKo } from './network'
import { loginKo } from './login'
import { aiKo } from './ai'
import { guardKo } from './guard'
import { guardAlertKo } from './guardAlert'
import { uxKo } from './ux'
import { inputFnsKo } from './inputFns'
import { assignKo } from './assign'
import { overlaysKo } from './overlays'

export const koStrings: Partial<Dict> = {
  ...baseKo,
  ...logbookKo,
  ...opsToolsKo,
  ...p9Ko,
  ...edit3dKo,
  ...planKo,
  ...videoKo,
  ...calibKo,
  ...plansKo,
  ...planeCmdKo,
  ...plannerKo,
  ...surveyKo,
  ...instrumentsKo,
  ...wpGoKo,
  ...inspRateKo,
  ...roiKo,
  ...cameraMediaKo,
  ...mavlinkCameraKo,
  ...cameraVideoKo,
  ...missionItemsKo,
  ...networkKo,
  ...loginKo,
  ...aiKo,
  ...guardKo,
  ...guardAlertKo,
  ...uxKo,
  ...inputFnsKo,
  ...assignKo,
  ...overlaysKo,
}
