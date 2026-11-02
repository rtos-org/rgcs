// Copy for the sign-in screen, its cloud transition and the 表示 (theme) setting (2026-10-25).

export const loginJa = {
  loginServer: '接続先',
  loginSigningIn: 'サインイン中…',
  loginSignedIn: 'サインインしました',
  loginCredit: '出典: 国土地理院(シームレス空中写真)',
  loginServerUp: 'サーバー稼働中',
  loginServerUnknown: 'サーバー状態不明',
  themeTitle: 'ログイン画面のテーマ',
  themeAuto: '自動',
  themeDark: 'ダーク',
  themeLight: 'ライト',
  themeNote: '自動は OS の設定に従います。',
}

export const loginEn: Record<keyof typeof loginJa, string> = {
  loginServer: 'Server',
  loginSigningIn: 'Signing in…',
  loginSignedIn: 'Signed in',
  loginCredit: 'Imagery: GSI Japan (seamless aerial photos)',
  loginServerUp: 'Server up',
  loginServerUnknown: 'Server status unknown',
  themeTitle: 'Sign-in screen theme',
  themeAuto: 'Auto',
  themeDark: 'Dark',
  themeLight: 'Light',
  themeNote: 'Auto follows the OS setting.',
}
