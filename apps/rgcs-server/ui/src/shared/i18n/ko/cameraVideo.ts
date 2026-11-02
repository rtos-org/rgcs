import type { cameraVideoJa } from '../cameraVideo'

export const cameraVideoKo: Record<keyof typeof cameraVideoJa, string> = {
  camEncoding: '인코딩',
  camPalette: '팔레트',
  camGain: '게인',
  camRangeHigh: '측정 범위 −20~150 °C',
  camRangeLow: '측정 범위 0~550 °C',
  camTempOverlay: '온도 표시',
  camAiBox: '추적 박스',
  camAutoRec: 'ARM 시 자동 녹화',
  camVideoNote: '메인 스트림만 변경합니다. H.265는 지원하는 브라우저에서만 재생됩니다.',
  camNoneNote: '카메라를 할당하면 영상 패널에 조작 버튼이 표시됩니다.',
}
