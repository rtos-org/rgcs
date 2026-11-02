// Copy for the MAVLink inspector's per-message rate controls (SET_MESSAGE_INTERVAL).

export const inspRateJa = {
  inspRate: 'レート',
  inspRateSet: '設定',
  inspRateDefault: '既定に戻す',
  inspRateStop: '停止',
  inspRateMeasured: '実測',
  inspRateInvalid: '0 より大きく 50 Hz 以下の数値を入力してください',
  inspRateNoteTx: 'RGCS が送信したメッセージのレートは変更できません',
  inspRateNoteComp: 'レートを変更できるのは機体のオートパイロット (コンポーネント 1) のメッセージだけです',
  inspRateNoteOffline: '機体が不明または通信断のため、レートを変更できません',
  inspRateNoteHeartbeat: 'HEARTBEAT のレートは変更できません (止まると機体が通信断になります)',
  inspRateCoreArmed: 'アーム中は主要テレメトリを停止できず、0.5 Hz 未満にもできません',
  inspRateArmedMin: 'アーム中は 0.5 Hz 以上を指定してください',
  inspRateSent: '送信しました。応答待ち…',
  inspRateOk: '受理されました',
  inspRateFail: '失敗',
} as const

export const inspRateEn: Record<keyof typeof inspRateJa, string> = {
  inspRate: 'Rate',
  inspRateSet: 'Set',
  inspRateDefault: 'Reset to default',
  inspRateStop: 'Stop',
  inspRateMeasured: 'Measured',
  inspRateInvalid: 'Enter a number above 0 and up to 50 Hz',
  inspRateNoteTx: 'The rate of messages RGCS sent cannot be changed',
  inspRateNoteComp: 'Only messages from the vehicle autopilot (component 1) can be re-rated',
  inspRateNoteOffline: 'The vehicle is unknown or the link is lost: the rate cannot be changed',
  inspRateNoteHeartbeat: 'The HEARTBEAT rate cannot be changed (without it the vehicle is lost)',
  inspRateCoreArmed: 'While armed, core telemetry cannot be stopped or set below 0.5 Hz',
  inspRateArmedMin: 'While armed, enter 0.5 Hz or more',
  inspRateSent: 'Sent. Waiting for the reply…',
  inspRateOk: 'Accepted',
  inspRateFail: 'Failed',
}
