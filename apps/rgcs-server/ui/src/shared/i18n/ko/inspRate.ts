import type { inspRateJa } from '../inspRate'

export const inspRateKo: Record<keyof typeof inspRateJa, string> = {
  inspRate: '레이트',
  inspRateSet: '설정',
  inspRateDefault: '기본값으로',
  inspRateStop: '정지',
  inspRateMeasured: '실측',
  inspRateInvalid: '0 초과 50 Hz 이하의 숫자를 입력하십시오',
  inspRateNoteTx: 'RGCS가 송신한 메시지의 레이트는 변경할 수 없습니다',
  inspRateNoteComp: '기체 오토파일럿(컴포넌트 1)의 메시지만 레이트를 변경할 수 있습니다',
  inspRateNoteOffline: '기체를 알 수 없거나 통신이 끊겨 레이트를 변경할 수 없습니다',
  inspRateNoteHeartbeat: 'HEARTBEAT 레이트는 변경할 수 없습니다(멈추면 기체 통신이 끊깁니다)',
  inspRateCoreArmed: '시동 중에는 주요 텔레메트리를 정지하거나 0.5 Hz 미만으로 설정할 수 없습니다',
  inspRateArmedMin: '시동 중에는 0.5 Hz 이상을 입력하십시오',
  inspRateSent: '송신했습니다. 응답 대기 중…',
  inspRateOk: '수락됨',
  inspRateFail: '실패',
}
