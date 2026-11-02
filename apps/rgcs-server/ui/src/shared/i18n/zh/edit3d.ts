import type { edit3dJa } from '../edit3d'

export const edit3dZh: Record<keyof typeof edit3dJa, string> = {
  mHelp8k: '3D：上下拖动编号 / 高度标签',
  mHelp8v: '只改变高度（多选时全部改变）',
  mHelp9k: '3D：拖动地面圆圈',
  mHelp9v: '只改变位置（保持高度）',
  mHelp10k: '航线颜色',
  mHelp10v:
    '单个任务：2D 按高度，3D 按爬升（水平为青色，爬升越陡越红，下降为紫色）。多个任务：使用列表颜色（3D 陡爬升仍为红色）',
  mHelp11k: '长按航段上的 +，然后拖动',
  mHelp11v: '将航段弯成圆弧（Arc WP，Copter 4.7+；拉直则恢复普通航点）',
  guidedSwitching: '正在切换到 GUIDED…',
  guidedModeTimeout: '飞行器未切换到 GUIDED，因此未发送移动',
  trackMinutes: '轨迹长度（分钟）',
  trackMinutesNote: '在运行地图（2D 与 3D）上保留最近这么多分钟的飞行轨迹；0 表示不保留',
  trackMinutesRange: '请输入 0–120 分钟',
  trackMinutesSaved: '已保存',
  elevProfile: '高程剖面',
  elevTerrainOk: '地形：高程瓦片',
  elevTerrainNone: '无地形数据（以起飞点地面显示）',
  elevGround: '地面',
  elevFlight: '飞行高度',
  elevAgl: '离地',
  elevBelowGround: '部分航线低于地面',
  elevEmpty: '添加航点后即可查看剖面',
  transferWrite: '写入中',
  transferVerify: '回读校验中',
}
