import type { mavlinkCameraJa } from '../mavlinkCamera'

export const mavlinkCameraKo: Record<keyof typeof mavlinkCameraJa, string> = {
  mavlinkCamera: 'MAVLink 카메라',
  compId: '컴포넌트 ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: '카메라가 명령을 거부했습니다',
  roiNativeNote: 'ArduPilot이 짐벌을 목표로 향하게 합니다',
  roiNoteNative: '조이스틱 버튼에 roi_1–roi_10을 할당하면 누를 때마다 추종을 시작 / 정지합니다.',
}
