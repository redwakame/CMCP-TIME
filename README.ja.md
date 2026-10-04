# CMCP-TIME

**原文を保ち、その間に流れた時間を理解する。**

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**AI エージェントのための時間を考慮した継続スキル。** 原文・画像・役割・時刻を使って対話を再開し、普段のホストとモデルをそのまま利用します。

**0.1.0 · Apache-2.0 · 原作者：[redwakame](https://github.com/redwakame)**

## 必要な原本に戻る

昨日の草稿を、今日は一か所だけ変更する。新しい対話でも CMCP は元の案と修正版を探し、User の決定と Assistant の提案を区別するための材料を提供します。画像の改訂も説明文だけでなく、各原本と出典との関係を保存します。

![原稿、改訂、対話をまたぐ正式な読取の利用例](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/continuity-source-flow.png)

Σ は派生要約の概念を示し、新しい要約機能の追加を意味しません。

図は用途の説明であり、実測したモデル回答ではありません。CMCP は出典を提供しますが、ホストの推論を置き換えたり最終回答を書き換えたりしません。正しい原文があってもモデルは誤解する場合があります。

## 0.1.0 をインストール

パッケージ：[`@redwakame-skill/cmcp-time`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.0)。固定ソース：[v0.1.0](https://github.com/redwakame/CMCP-TIME/tree/v0.1.0)。`main` には後続変更が入る場合があります。以下では版を固定します。`latest` と `next` は変更可能な配布チャネルです。

Node.js **22.16.0 以上**と npm を用意します。プログラムと許可した作業データを別々の永続ディレクトリに置きます。次の PowerShell 例は管理者権限やグローバル PATH の変更を必要としません。

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.0 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

ウィザードはローカル設定と管理対象の Codex 接続を扱います。公式 Harness Desktop と任意の MCP/Hermes は[操作ガイド](docs/release-readiness.ja.md)の別手順に従います。インストールだけでホスト接続、私的な会話の取込、有料モデル利用の許可、自動通知は行われません。永続接続に一時的な `npx` キャッシュを使わないでください。

[POSIX・ローカルパッケージ・更新](docs/npm-installation.md) · [クイックスタート](docs/quick-start.md)

## 検証範囲に合う入口を選ぶ

![一つの許可された原文ストアと任意のホスト・MCP 接続](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/host-interoperability.png)

別々に検証した順次引継ぎ：Codex ↔ Harness、Hermes ↔ Harness。三ホスト並行・同一回の三者検証ではなく、点線 MCP は同一 Core を使う任意入口です。

| 経路 | 実証した範囲 | 制限 |
|---|---|---|
| 公式 DeepSeek Harness Desktop 0.2.0-rc.2 | ネイティブ文字対話、画像原本、新しい対話での読取、制御、明示 Pin のアプリ内配信 | Desktop GUI と隔離 SDK の証拠は別。24/7 やモバイル通知は保証しない |
| Codex | Skill/Hook、公式 app-server の文字引継ぎ、限定的なネイティブ圧縮 | 明示したプロジェクトとアカウント経路。任意の App 対話を自動収集しない |
| Hermes v2026.9.24 / 0.21.5 | 公式のヘッドレスなライフサイクル、ネイティブツール、Harness SDK との文字引継ぎ | Python/Git Bash は外部依存。DeepSeek 経路を検証。TUI や Desktop GUI の認証ではない |
| MCP stdio / Streamable HTTP | 実クライアント、正式読取、メディア handle、範囲・失効制御、永続ローカルサービス | 任意の転送層。ローカル試験は遠隔クラウド、TLS 配備、プラットフォーム審査の証明ではない |

OpenClaw、dots、Grok Bot、Muse の要件は[能力表](docs/interop-capabilities.zh-TW.md)で区別します。最新の相互接続増分は Windows Node 24.18.0 で実行済みです。以前の Linux/Node 22.16.0 の証拠は、新しい全アダプターや全 OS の検証にはなりません。四言語の文書も四言語動作の認証ではありません。

## 使う・確認する・停止する

![最小入口、必要時の詳細画面、権限と保存の独立制御](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/controls-modes.png)

概念図であり実 GUI のスクリーンショットではありません。1 最小、2 一行、3 非表示。

| 用途 | 入口 |
|---|---|
| Desktop ネイティブ制御 | `/cmcp help`。`/cmcp on` は現在の対話に参加、`/cmcp off` は離脱 |
| 最小・一行・非表示 | `/cmcp ui minimized`、`/cmcp ui row`、`/cmcp ui hidden`。非表示でも無効化されない |
| 出典・時刻・画像原本 | 出典一覧 → 正式な原文読取 → 許可済みメディア表示。**READ-ALL** は選択した許可済み集合の全ページで、top-k ではない |
| UI なしの引継ぎ | `cmcp-time project init`、続いて `project open --config <entry.json>`。選んだホストを明示的に有効化 |
| 明示的なフォロー | Pin 画面で正式出典・対象・任意の時刻を選択。時刻なしでは自動通知しない |
| データとライフサイクル | `data help`、`desktop help`、`mcp help`、`hermes help`。バックアップ・復元・可逆な接続解除 |

History、Buffer、Pin は別の責任を持ちます。Buffer は既定 12 時間、6–48 時間に設定可能。期限切れや Clear は History と独立 Pin を削除しません。自動通知は初期 OFF。DND、現時点の出典権限、取消、重複防止に従い、配信を完了や既読とは扱いません。対話参加で共有 OFF/Clean や保存設定を変更しません。

**保存済みでも読取可能とは限りません。** 原本保存、登録待ち・失敗、正式読取資格、ホスト間利用の評価状態を分けて表示します。保存メタデータだけでは受信側への引継ぎを評価していません。正式読取とホストの受領記録を別途確認してください。閲覧や UI 切替では原時刻・TTL・権限・配信資格を更新しません。原本欠落、版変更、権限失効は拒否します。

更新前に[バックアップ・復元・更新手順](docs/release-readiness.ja.md)を確認してください。プログラム、History、ホスト独自履歴、保護された資格情報は別管理です。CMCP の解除で原本は残りますが、ホスト履歴の消去や完全な削除管理は意味しません。0.1.0 はベクトル、音声・動画、クラウド同期、複数利用者の並行 writer を提供しません。

## 文書とプロジェクト

[操作ガイド](docs/release-readiness.ja.md) · [MCP/Hermes とセルフホスト](docs/interop.ja.md) · [コマンド](docs/commands.md) · [設定](docs/configuration.md) · [プライバシー](docs/privacy.md) · [証拠と制限](docs/verification.md) · [ロードマップ](docs/roadmap.md)

**現在の開発主線は CMCP-TIME です。** [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) と [cmcp](https://github.com/redwakame/cmcp) は以前のコードと方針を別のライセンス・証拠とともに保持します。そのままの置換や自動移行を意味しません。

## 作者と参加方法


再現可能な不具合報告、利用の感想、独立検証、協力の提案を歓迎します。公開 Issue に私的な会話や秘密情報を貼らないでください。[CONTRIBUTING](CONTRIBUTING.md)、[SECURITY](SECURITY.md)、[プライバシー](docs/privacy.md)、[ロードマップ](docs/roadmap.md)を参照してください。

CMCP-TIME に興味をお持ちの方は、ぜひアイデアや利用の感想をお寄せください。役に立ったと感じたら、GitHub のスターで応援していただけるとうれしいです。今後も改善と更新を続けていきます。商用での協業のご相談も歓迎します。連絡先：[adarobot666@gmail.com](mailto:adarobot666@gmail.com) または [redwakame616@gmail.com](mailto:redwakame616@gmail.com)。

原作者・メンテナーは **redwakame**。現在の配布は [Apache-2.0](LICENSE) と [NOTICE](NOTICE)、[過去のライセンス情報](docs/license-provenance-v0.1.md)に従います。以前に許諾した権利は取り消しません。内部互換識別子は `cmcp`、公開名は **CMCP-TIME** です。[CITATION.cff](CITATION.cff) は引用を容易にするための情報であり、利用のたびに宣伝を義務付ける条項ではありません。

[0.1.0](docs/release-0.1.0.md) · [再実行可能な検証](docs/testing.md)
