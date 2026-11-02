# RGCS

[English](README.md)

RGCS は [ArduPilot](https://ardupilot.org) 機体(Copter / QuadPlane / Plane / Rover)向けの Web 地上局です。
- Rust のサーバー `rgcs-server` 1 つが、機体との MAVLink 通信、カメラ操作、映像の中継、Web UI の配信を受け持ちます。
- 操作する人は、LAN や LTE / VPN 越しにブラウザから使います。
- サーバーは軽いので、機体のコンパニオンコンピュータ(Raspberry Pi)にも、無線機のそばのノート PC にも置けます。

> **状態: 開発初期(0.x)。** 開発と試験飛行で使っています。どの運航についても認証は受けていません。安全で法令に沿った飛行と、計画をシミュレータで事前に確かめることは、使う人の責任です。[安全について](#安全について)も読んでください。

## できること

- **運用マップ**
  - つながっている全機体を 2D / 3D 地図に表示します(航跡、姿勢、バッテリー、通信、メッセージ)。
  - コマンド: アーム、離陸、モード変更、RTL / 着陸、Guided の「ここへ飛ぶ」。アーム、ディスアーム、離陸、ミッション開始は UI での確認が必要です。
- **フライトプラン**
  - 2D / 3D でウェイポイントを作成でき、標高断面、測量グリッド、ジオフェンス、ラリーポイントも扱えます。
  - 複数のプランを同時に開き、並べて比べ、機体に割り当てられます。
  - 飛行前チェックの警告は、ワンクリックで修正できます。
  - Mission Planner と `.waypoints` を誤差なくやりとりできます。
- **映像・カメラ**
  - MediaMTX 経由で WebRTC 映像を表示します。
  - SIYI MT11 ジンバルカメラを操作できます(ズーム、サーマル、AI 追尾、GPS ROI)。
  - MAVLink カメラ・ジンバル、ゲームパッド / ジョイスティック操作にも対応します。
- **メンテナンス**
  - ArduPilot のメタデータ付きのパラメータ編集。
  - 校正、日常点検、飛行日誌、点検整備記録(PDF / CSV 出力)。
  - DataFlash ログの取り出し。
- **外的要因**
  - 公開データから天気・風・宇宙天気を取得します。
  - 危険な状況で警告し、同意のもとで対処する実験機能があります(監査ログ付き)。
- **観客用画面**: 取り消せるリンクで開く、表示専用の 2 画面目です。
- **AI チャット(任意)**: 機体について質問できます。コマンドは提案するだけで、操作する人が押すまで送信しません。
  - 対応: Anthropic、または Ollama などの OpenAI 互換サーバー。
- **プラグイン**: `plugin.toml` をフォルダに置くと、地図の重ね表示やリンクを追加できます。[PLUGINS.md](PLUGINS.md) を参照してください。
- **UI の言語**: 英語、日本語、簡体字中国語、韓国語。既定はブラウザの言語に従います。

## リポジトリ構成

| パス | |
|---|---|
| `apps/rgcs-server` | サーバー(axum)と、`ui/` に Web UI(React、MapLibre) |
| `crates/rgcs-core` | 共通の型。TypeScript の型は ts-rs で生成 |
| `crates/rgcs-mavlink` | MAVLink の接続、ルーティング、コマンド、パラメータ・ミッション・ログのプロトコル |
| `crates/rgcs-mission` | ミッションのモデルと `.waypoints` の読み書き |
| `crates/rgcs-store` | SQLite の保存とマイグレーション |
| `crates/rgcs-camera`, `rgcs-video`, `rgcs-input` | カメラ・ジンバルのドライバ、映像中継、ゲームパッド入力 |
| `crates/rgcs-ai`, `rgcs-guard`, `rgcs-env` | AI チャット、危険監視、外部データ |
| `deploy/` | Raspberry Pi 用のインストーラ、systemd ユニット、`config.toml.example`、MediaMTX 設定 |
| `scripts/` | 開発スタック、Docker の SITL、E2E テスト、Pi 用ビルド |
| `examples/plugins/` | プラグインの例 |

## 開発の始め方

必要なもの:
- Rust(stable。`rust-toolchain.toml` で入ります)
- Node.js 22
- Docker(ArduPilot SITL を自分でビルドせずに動かすため)
- このリポジトリの隣に置いた ArduPilot のチェックアウト(`../ardupilot`。別の場所なら `ARDUPILOT_DIR` で指定)
- 映像を試すなら MediaMTX と ffmpeg

```sh
# 最初に一度: ArduPilot のチェックアウトから SITL のイメージを作る
scripts/sitl-docker.sh build

# SITL のコプター 1 機 + rgcs-server + UI(ホットリロード)
scripts/dev.sh --docker --sitl 1
# http://127.0.0.1:5173 を開き、admin / admin でログイン(開発用ログイン)

# 機体の種類を 1 機ずつ、MT11 シミュレータとテスト映像も
scripts/dev.sh --docker --sitl 1 --quadplane --plane --rover --siyi-sim --video
```

オプションの一覧は `scripts/dev.sh --help` で見られます。実行時のファイルは `.dev/`(git 管理外)に置かれます。

### チェック

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

cd apps/rgcs-server/ui
npm ci
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test -- --run

scripts/e2e.sh            # :8010 の実サーバーに対する Playwright
```

## Raspberry Pi への配備

`scripts/build-pi.sh` で、UI を埋め込んだ aarch64 のリリースビルドとインストーラをまとめて作ります。Pi では次を実行します。

```sh
tar xzf rgcs-pi-<version>.tar.gz && cd rgcs-pi-<version> && sudo ./install.sh
```

手順の詳細、MediaMTX、観客用画面は [deploy/README.md](deploy/README.md) にあります。設定は `/etc/rgcs/config.toml` で、主な項目は [deploy/config.toml.example](deploy/config.toml.example) で説明しています。

**セキュリティ**: アカウントを作るまでは、開発用ログイン `admin` / `admin` が有効です。ポート 8000 は機体の LAN か VPN の中だけに公開してください。脆弱性は公開の Issue には書かず、[SECURITY.md](SECURITY.md) の方法で非公開で報告してください。

## 地図とデータの取得元

RGCS は地図データを同梱しません。既定では、次の取得元にインターネット経由でアクセスします。使い方が各提供元の規約に合うかを確認し、必要なら `config.toml` で差し替えてください。

| データ | 既定の取得元 | 注意 |
|---|---|---|
| 背景地図 | OpenStreetMap タイル、地理院タイル | OSM のタイルサーバーは軽い利用だけが前提です([方針](https://operations.osmfoundation.org/policies/tiles/))。継続して使うなら `[[basemaps]]` で自前の提供元を設定してください |
| 3D 地形 | AWS Terrain Tiles(Terrarium) | `terrain_tiles = ""` で 3D をオフにできます |
| 地名検索 | OpenStreetMap Nominatim(ブラウザから) | Nominatim の[利用方針](https://operations.osmfoundation.org/policies/nominatim/)に従います |
| 気象 | Open-Meteo、気象庁アメダス、OpenWeatherMap(自分のキーで) | Open-Meteo の無料 API は非商用向けです。商用なら API キーを設定してください |
| 宇宙天気 | NOAA SWPC、GFZ の Kp 指数 | |

プラグインで取得元を追加することもできます。その規約を守るのは、プラグインの作者と利用者の責任です。

## 安全について

- RGCS は実際の機体に実際のコマンドを送ります。アーム、離陸、ミッション開始は UI での確認が必要で、確認のない要求はサーバーが拒否します。それでも、計画そのものが安全になるわけではありません。
- 新しい計画は、まず SITL で飛ばしてください。手動で操縦できる人と、RGCS とは別のフェイルセーフ(送信機、機体側の RTL / 着陸設定)を必ず用意してください。
- 電波・気象・地形のデータは、第三者が提供する計画用の参考情報です。上空でのことも含め、何も保証しません。

## 貢献

Issue とプルリクエストを歓迎します(英語・日本語どちらでも)。手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。コードの貢献には [Contributor License Agreement](CLA.md)(CLA)への同意が必要です。著作権は貢献した人に残り、貢献したコードは常に RGCS のオープンなライセンスでも提供され続けます。

## ライセンス

RGCS の著作権は RtoS Co., Ltd.(© 2026)にあります。ライセンスは [GNU Affero General Public License v3.0 以降](LICENSE)で、[RGCS Plugin Exception](LICENSE-EXCEPTION.md) を加えています。[PLUGINS.md](PLUGINS.md) に定めた方法だけで RGCS を使うプラグインは、どのライセンスでも配布できます。

RGCS を改変してネットワーク越しに利用者へ提供する場合、AGPL により、その利用者にソースコードを提供する義務があります。

第三者のものは、それぞれのライセンスに従います。
- UI フォントの IBM Plex Sans JP と IBM Plex Mono(Fontsource から同梱、SIL OFL 1.1)、PDF 帳票用の Noto Sans JP(`assets/fonts`、SIL OFL 1.1)
- ArduPilot のパラメータ説明(`apps/rgcs-server/ui/public/params`、GPL-3.0)
- `Cargo.lock` と `package-lock.json` にある Rust / npm の依存パッケージ

「RGCS」の名称とロゴは RtoS Co., Ltd. の商標です。フォークや改変版は別の名前で歓迎します。詳しくは [TRADEMARKS.md](TRADEMARKS.md) を参照してください。
