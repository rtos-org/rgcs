import type { inspRateJa } from '../inspRate'

export const inspRateZh: Record<keyof typeof inspRateJa, string> = {
  inspRate: '频率',
  inspRateSet: '设置',
  inspRateDefault: '恢复默认',
  inspRateStop: '停止',
  inspRateMeasured: '实测',
  inspRateInvalid: '请输入大于 0 且不超过 50 Hz 的数值',
  inspRateNoteTx: 'RGCS 发送的消息频率无法更改',
  inspRateNoteComp: '只能更改飞行器自驾仪（组件 1）发出的消息频率',
  inspRateNoteOffline: '飞行器未知或链路丢失：无法更改频率',
  inspRateNoteHeartbeat: 'HEARTBEAT 频率无法更改（没有它飞行器会失联）',
  inspRateCoreArmed: '解锁状态下，核心遥测不能停止或低于 0.5 Hz',
  inspRateArmedMin: '解锁状态下请输入 0.5 Hz 或以上',
  inspRateSent: '已发送。等待应答…',
  inspRateOk: '已接受',
  inspRateFail: '失败',
}
