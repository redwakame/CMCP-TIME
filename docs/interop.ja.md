# 任意の MCP とセルフホストサービス

CMCP は Skill-first を維持します。既存のローカル操作とネイティブ宿主は常駐サービスを必要としません。MCP は同じ Core と正式 reader を使う入口であり、別の回答を生成したり原本 History を置き換えたりしません。

```sh
cmcp-time mcp help
cmcp-time service help
cmcp-time data help
```

[MCP 手順](../adapters/mcp/README.md)、[設定例](interop-config-examples.md)、[能力一覧](interop-capabilities.zh-TW.md)を参照してください。`service` は `mcp` と同じ入口です。明示的に承認した独立プロジェクトに永続データを保存します。

モデルに渡すのは読取用ツールだけです。User 原文と表示された Assistant 回答は、信頼された宿主イベントから保存します。モデルが指定した役割や時刻だけでは原文として認証しません。人間による承認、登録再試行、共通制御は別の入口です。導入だけで全会話を共有したり能動動作を有効化したりしません。

保存済み原本、登録待ち、登録失敗、現在の正式読取資格を区別します。別の宿主から利用するには、その受信側の承認済み binding も必要です。表示だけでは再試行しません。既存の人間用メニューまたは `retry-registration` 操作で、OFF／Clean／取消の保護を維持したまま再試行します。容量を拡張したり原本を削除したりしません。

HTTP の既定は loopback です。遠隔利用には明示的な認証と HTTPS、または信頼されたリバースプロキシが必要です。事前設定 JWT は OAuth ログインサーバーではありません。プログラム、永続データ、一時ファイル、秘密情報を分離してください。同じ OS アカウントで自由に Shell／ファイルへアクセスできる場合、秘密情報の隔離は保証されません。

サービスを停止してから正式な `data export/verify/restore` を使います。詳細は `data help`。再起動後は承認を再確認し、古い token や通信 session だけで実行権限を復元しません。無効化や接続解除は History と媒体を削除しません。[Hermes 接続](../adapters/hermes/README.md)も参照してください。

CMCP-TIME 0.1.0 は任意のローカル/セルフホスト接点を提供します。ローカル検証はクラウド配備や審査承認ではありません。[版の識別](release-0.1.0.md)と[操作ガイド](release-readiness.ja.md)を参照してください。

## Hermes の通常入口

README に従い、固定した公式 Hermes を独立環境へ導入します。プレースホルダーを明示的なローカルパスへ置き換え、鍵の値をコマンドへ記載しないでください。`credential-file` は既に承認した認証ファイルです。Windows の標準ツールには設定済み Git Bash が必要で、`--git-bash <bash.exe>` を指定できます。

```text
cmcp-time hermes configure --service <mcp-service.json> --python <Python> --home <新しいプロジェクトprofile> --credential-file <既存認証ファイル> --output <hermes.json>
cmcp-time hermes inspect --config <hermes.json>
cmcp-time hermes chat --config <hermes.json> --session <新Session> --authorize-session --stdin
```

対応する MCP サービスを先に起動し、通常の入力を stdin から送ります。同じ Session は宿主履歴を使い、新しい Session は CMCP の承認済み原本を正式に検索します。`--authorize-session` を `--native-only` に置き換えると、原本を削除せず CMCP 保存なしで宿主を使えます。日常の追加ログは既定でメタデータのみですが、Hermes 自身の会話履歴は別の保存責任です。正式な取消と停止を使い、解放回執を確認してください。

`hermes harness-configure` と `harness-chat` は既存 Harness driver を使う明示的な合成相互運用試験です。後者には `--synthetic-evidence` が必要です。合成証拠全文を記録するこの profile を日常の私的会話には使わないでください。他の宿主やプラットフォームの審査は能力一覧で区別します。

## 依存の準備とサービス操作

新しい Python 3.11–3.13 環境（実行済み 3.12.14）を使います。先に公式 Hermes v2026.9.24、commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`（パッケージ 0.21.5）を取得し、editable のパスにはその確認済みソースを指定します。Windows は別途 Git Bash が必要で、可搬版 2.56.0.windows.1 を検証済みです。`--git-bash <bash.exe>` は子環境だけに作用します。通常 wheel の導入は検証済みではありません。[再構築](../adapters/hermes/dependencies.md)も参照してください。

```text
python -m venv <new-venv>
<venv-python> -m pip install -r <cmcp-package>/adapters/hermes/requirements-tested.txt
<venv-python> -m pip install --no-deps --no-build-isolation -e <verified-official-hermes-source>
```

```text
cmcp-time mcp init --root <new-project-root> --project <project-name> --hosts generic,hermes,harness --port 8766 --timezone <IANA-timezone>
cmcp-time mcp check --config <new-project-root>/mcp-service.json
cmcp-time mcp start --config <new-project-root>/mcp-service.json
```

```text
cmcp-time mcp health --config <new-project-root>/mcp-service.json
cmcp-time mcp capabilities --config <new-project-root>/mcp-service.json
cmcp-time mcp stop --config <new-project-root>/mcp-service.json
```

`<venv-python>` は隔離環境自身の実行ファイルで、activate や全体 PATH 変更は不要です。すべてのプレースホルダーを置き換えます。npm は固定 MCP 依存を含み、ソースでは `npm ci` を使います。一方の端末で start、別の端末で health/capabilities と最後の stop を行います。初期化は明示した新規プロジェクトの User/Assistant 保存を許可し、proactive/Pin は OFF、各 Session は参加が必要です。既存対話を取り込みません。`--stdin` は EOF 後に送信されます。`--message "質問"` も使用できます。
