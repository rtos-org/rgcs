// Copy for the 全機体映像 view and the camera cockpit (prototype `t.cam`).

export const videoJa = {
  restore: '元に戻す',
  zoom: 'ズーム',
  gimbal: 'ジンバル',
  gimbalMode: 'ジンバルモード',
  videoRow: '映像',
  sbs: '2画面',
} as const

export const videoEn: Record<keyof typeof videoJa, string> = {
  restore: 'Restore',
  zoom: 'Zoom',
  gimbal: 'Gimbal',
  gimbalMode: 'Gimbal mode',
  videoRow: 'Video',
  sbs: 'Split',
}
