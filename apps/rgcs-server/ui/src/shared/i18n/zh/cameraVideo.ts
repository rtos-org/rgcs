import type { cameraVideoJa } from '../cameraVideo'

export const cameraVideoZh: Record<keyof typeof cameraVideoJa, string> = {
  camEncoding: '编码',
  camPalette: '伪彩',
  camGain: '增益',
  camRangeHigh: '范围 −20 至 150 °C',
  camRangeLow: '范围 0 至 550 °C',
  camTempOverlay: '温度叠加',
  camAiBox: '跟踪框',
  camAutoRec: '解锁时自动录像',
  camVideoNote: '仅更改主码流。H.265 仅在支持的浏览器中播放。',
  camNoneNote: '分配相机后，其控件会显示在视频面板上。',
}
