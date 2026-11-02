import type { loginJa } from '../login'

export const loginZh: Record<keyof typeof loginJa, string> = {
  loginServer: '服务器',
  loginSigningIn: '正在登录…',
  loginSignedIn: '已登录',
  loginCredit: '来源：日本国土地理院（无缝航空照片）',
  loginServerUp: '服务器运行中',
  loginServerUnknown: '服务器状态未知',
  themeTitle: '登录界面主题',
  themeAuto: '自动',
  themeDark: '深色',
  themeLight: '浅色',
  themeNote: '自动将跟随操作系统设置。',
}
