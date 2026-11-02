// Copy for the MAVLink camera driver (the `mavlink` camera kind).

export const mavlinkCameraJa = {
  mavlinkCamera: 'MAVLink カメラ',
  compId: 'コンポーネント ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: 'カメラがコマンドを拒否しました',
  roiNativeNote: 'ArduPilot がジンバルを目標に向けます',
  roiNoteNative: 'ジョイスティックの roi_1〜roi_10 に割り当てると、押すたびに追従を開始 / 停止します。',
} as const

export const mavlinkCameraEn: Record<keyof typeof mavlinkCameraJa, string> = {
  mavlinkCamera: 'MAVLink camera',
  compId: 'Component ID',
  rtspUrl: 'RTSP URL',
  camErr_camera_rejected: 'The camera refused the command',
  roiNativeNote: 'ArduPilot points the gimbal at the target',
  roiNoteNative: 'Assign roi_1–roi_10 to joystick buttons to start / stop pointing with one press.',
}
