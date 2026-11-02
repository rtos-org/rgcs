import type { plannerJa } from '../planner'

export const plannerKo: Record<keyof typeof plannerJa, string> = {
  upTitle: '쓸 기체 선택',
  upAll: '모두 선택',
  upNone: '모두 해제',
  upWriteN: '기체 {n}대에 쓰기',
  upTarget: '대상',
  upFatal: '검사에서 치명적인 문제가 발견되어 쓰지 않았습니다',
  plSearch: '장소 검색',
  plSearchHint: '지명 또는 주소, 또는 위도, 경도',
  plSearchNone: '찾을 수 없습니다',
  plSearchFail: '검색에 실패했습니다',
  plToVehicle: '기체 위치로',
  plLoaded: '{n}건을 불러왔습니다',
  plFenceSide: '펜스 설정',
  plRallySide: '랠리 포인트 설정',
  plFileBad: '파일을 읽을 수 없습니다',
}
