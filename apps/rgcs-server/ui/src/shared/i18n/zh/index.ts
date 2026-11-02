// Chinese (Simplified, zh-CN) UI strings, one file per dictionary module (same names as ../*.ts). Keys missing here
// fall back to English at runtime; lang.test.ts requires every key to be translated.
import type { Dict } from '../index'
import { baseZh } from './base'
import { logbookZh } from './logbook'
import { opsToolsZh } from './opsTools'
import { p9Zh } from './p9'
import { edit3dZh } from './edit3d'
import { planZh } from './plan'
import { videoZh } from './video'
import { calibZh } from './calib'
import { plansZh } from './plans'
import { planeCmdZh } from './plane'
import { plannerZh } from './planner'
import { surveyZh } from './survey'
import { instrumentsZh } from './instruments'
import { wpGoZh } from './wpGo'
import { inspRateZh } from './inspRate'
import { roiZh } from './roi'
import { cameraMediaZh } from './cameraMedia'
import { mavlinkCameraZh } from './mavlinkCamera'
import { cameraVideoZh } from './cameraVideo'
import { missionItemsZh } from './missionItems'
import { networkZh } from './network'
import { loginZh } from './login'
import { aiZh } from './ai'
import { guardZh } from './guard'
import { guardAlertZh } from './guardAlert'
import { uxZh } from './ux'
import { inputFnsZh } from './inputFns'
import { assignZh } from './assign'
import { overlaysZh } from './overlays'

// Typed as the full Dict so a key added to any module without a zh string fails the type check.
const all: Dict = {
  ...baseZh,
  ...logbookZh,
  ...opsToolsZh,
  ...p9Zh,
  ...edit3dZh,
  ...planZh,
  ...videoZh,
  ...calibZh,
  ...plansZh,
  ...planeCmdZh,
  ...plannerZh,
  ...surveyZh,
  ...instrumentsZh,
  ...wpGoZh,
  ...inspRateZh,
  ...roiZh,
  ...cameraMediaZh,
  ...mavlinkCameraZh,
  ...cameraVideoZh,
  ...missionItemsZh,
  ...networkZh,
  ...loginZh,
  ...aiZh,
  ...guardZh,
  ...guardAlertZh,
  ...uxZh,
  ...inputFnsZh,
  ...assignZh,
  ...overlaysZh,
}

export const zhStrings: Partial<Dict> = all
