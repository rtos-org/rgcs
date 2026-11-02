// Copy for the detail panel's attitude indicator and compass.

export const instrumentsJa = {
  instAttitude: '姿勢',
  instHeading: '方位',
  instRoll: 'ロール',
  instPitch: 'ピッチ',
  instNoData: 'データなし',
} as const

export const instrumentsEn: Record<keyof typeof instrumentsJa, string> = {
  instAttitude: 'Attitude',
  instHeading: 'Heading',
  instRoll: 'Roll',
  instPitch: 'Pitch',
  instNoData: 'No data',
}
