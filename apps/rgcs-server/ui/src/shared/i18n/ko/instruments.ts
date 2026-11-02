import type { instrumentsJa } from '../instruments'

export const instrumentsKo: Record<keyof typeof instrumentsJa, string> = {
  instAttitude: '자세',
  instHeading: '헤딩',
  instRoll: '롤',
  instPitch: '피치',
  instNoData: '데이터 없음',
}
