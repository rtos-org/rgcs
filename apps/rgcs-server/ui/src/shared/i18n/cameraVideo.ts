// Copy for the camera settings 映像 tab (prototype `t.cam`).

export const cameraVideoJa = {
  camEncoding: 'エンコード',
  camPalette: 'パレット',
  camGain: 'ゲイン',
  camRangeHigh: '測定レンジ −20〜150℃',
  camRangeLow: '測定レンジ 0〜550℃',
  camTempOverlay: '温度表示',
  camAiBox: '追跡ボックス',
  camAutoRec: 'ARM で自動録画',
  camVideoNote: 'メインストリームだけを変更します。H.265 は対応ブラウザのみ再生できます。',
  camNoneNote: 'カメラを割り当てると映像パネルに操作が表示されます。',
} as const

export const cameraVideoEn: Record<keyof typeof cameraVideoJa, string> = {
  camEncoding: 'Encoding',
  camPalette: 'Palette',
  camGain: 'Gain',
  camRangeHigh: 'Range −20 to 150 °C',
  camRangeLow: 'Range 0 to 550 °C',
  camTempOverlay: 'Temperature overlay',
  camAiBox: 'Tracking box',
  camAutoRec: 'Auto record on ARM',
  camVideoNote: 'Changes the main stream only. H.265 plays only in browsers that support it.',
  camNoneNote: 'Assign a camera to show its controls on the video panel.',
} as const
