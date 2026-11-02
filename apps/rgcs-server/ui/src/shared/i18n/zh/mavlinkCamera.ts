import type { mavlinkCameraJa } from '../mavlinkCamera'

export const mavlinkCameraZh: Record<keyof typeof mavlinkCameraJa, string> = {
  mavlinkCamera: 'MAVLink 相机',
  compId: '组件 ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: '相机拒绝了该命令',
  roiNativeNote: '由 ArduPilot 将云台指向目标',
  roiNoteNative: '将 roi_1–roi_10 分配给摇杆按键，即可一键开始 / 停止指向。',
}
