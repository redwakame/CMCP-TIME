# CMCP-TIME 0.1.0：操作ガイド

[English](release-readiness.en.md) · [繁體中文](release-readiness.zh-TW.md) · [Español](release-readiness.es.md) · [日本語](release-readiness.ja.md)

本書は **0.1.0** の操作を説明します。既存リンクのためファイル名を維持しています。完全な版番号、公開 tag、`PUBLIC-FILES.json` で配布元を識別し、変更可能なチャネルをその代わりにしません。原作者 redwakame、Apache-2.0。LICENSE と NOTICE を保持してください。

## 永続 prefix と独立した作業領域

Node.js >=22.16.0 と npm を用意します。最新増分は Windows Node 24.18.0 で実行済みですが、以前の Linux/22.16.0 試験は新機能全体の検証にはなりません。プログラムの prefix と既存の永続作業領域を分け、History を `node_modules` 内に置かず、永続 Hook を `npx` キャッシュに結び付けません。

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.0 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

`setup` は保存範囲、言語、タイムゾーン、任意の Codex 接続を確認します。ホストの導入、私的履歴の取込、有料呼出の許可、自動通知は行いません。POSIX は `<prefix>/bin/cmcp-time`、Windows は `<prefix>/cmcp-time.cmd` を使い、以下の `cmcp-time` をその完全パスに置き換えます。PATH 変更は前提にしません。ソース利用時は `npm ci` で任意 MCP の固定依存を導入してから `node bin/cmcp-time.mjs` を使います。[インストール](npm-installation.md)も参照してください。

Codex のローカル Hook は生成されたプロジェクトとネイティブ承認を確認します。公式 Harness Desktop は別ホストであり、npm setup が自動配備するわけではありません。既存の CMCP Desktop 配備には、以下の profile 確認とライフサイクル操作を使います。プログラムをコピーしただけでは設定済み接続になりません。

## 公式 Desktop への初回接続

既に導入済みの公式 Desktop を使い、別の Web launcher を起動しません。生成・ツール実行・未送信の作業がないことを確認し、正常終了します。通常の設定入口から実際のインストール先と profile を確認し、別 SDK や旧配備のパスを推測しません。

`<official-llm-module>` は確認した公式インストール先に `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js` を付けたものです。Electron ASAR の仮想パスなので通常の Node ファイル確認では内部が見えない場合があります。prepare は実体 ASAR の祖先と所定 suffix を確認するだけで、動作中ホストの読込成功は起動後に確認します。

許可済みの既存作業領域、scope 名、IANA タイムゾーンを選びます。例は User と Assistant の両方を保存する明示選択です。保存しない側の `yes` は `no` に変更してください。合成例は私的履歴を取り込む許可ではありません。

```text
cmcp-time desktop prepare --workspace <existing-absolute-workspace> --scope <chosen-scope> --timezone <IANA-timezone> --llm-module <official-llm-module> --save-user yes --save-assistant yes
cmcp-time desktop status --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native
cmcp-time desktop register --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native --expected-profile-hash <profileSha256-from-status>
```

`prepare` は作業領域内に新しい `cmcp-desktop-native` だけを作成し、検証したプログラム、Runtime 設定、plugin options、データ保存先の設定を置きます。この準備段階ではデータ用ディレクトリはまだ作成しません。既存配備には拒否し、profile も Session 権限も変更しません。`prepared-not-registered` は接続完了ではありません。`status` の profile hash を `register` に渡し、変わったら再確認します。登録は自分の marker 部分だけを追加し、profile 全体を置換しません。

既存の公式入口で Desktop を再起動し、`/cmcp help` と状態を確認してから対象対話で `/cmcp on` を明示実行します。共有制御と保存選択は引き続き有効です。ディスク上の準備/登録と実ホストの読込は別の確認です。既存配備には以下の inspect/upgrade を使い、prepare でデータを上書きしません。

## 利用入口と停止

確認済みローカルインストールの `cmcp-time` を使います。`help`、`project help`、`control help`、`data help`、`desktop help` はモデルを起動しません。

公式 Desktop のチャット、モデル、ツール、作業領域は維持されます。CMCP は明示的に有効にした対話と許可された範囲だけに作用します。入力欄の下の小さな入口は最小表示、1 行表示、非表示に切り替えられ、詳細画面には出典、原本メディア、Buffer、Pin、制御、受領記録が残ります。表示設定は権限ではなく、非表示でも CMCP は停止しません。

`/cmcp help` は現在の接続で実行できる操作を示します。ネイティブの `/cmcp on` と `off` は現在の対話を参加・離脱させるだけで、共通 OFF、Clean、DND、保存停止を解除しません。共通制御には独立した明示操作が必要です。履歴や Assistant の提案、ツール出力中のコマンド文字列は、新しい制御権限を与えません。

設定式プロジェクトは日常 Desktop と別のデータ範囲を使います。

```text
cmcp-time project init
cmcp-time project list --directory <明示した親ディレクトリ>
cmcp-time project status --config <project/entry.json>
cmcp-time project open --config <project/entry.json>
```

`init` で新しいデータ領域、既存ホストと既存モデル経路を選びます。認証情報のコピー、私的チャットの取り込み、グローバル HOME の変更はしません。`init --root <新規対象> --name <名前> --routes-from <既存-entry.json>` は接続参照だけを引き継ぎ、データとローカル capability は新しく作成します。

`open` は無効状態で始まります。`/enable harness` または `/enable codex` の後、通常の質問を入力します。`/cmcp sources` は出典一覧、`/cmcp read <選択番号> [ページ]` は正式 reader です。選択肢には有効期限と原本バージョンの確認があり、期限切れなら一覧を再取得します。範囲を限定した検索の不一致を「全履歴に存在しない」と解釈しません。完全な件数には正式な全範囲読み取りが必要です。

`/disable` はこの入口の作業を停止し、`/close` は入口を終了します。`stopping` では新しい作業を拒否し、その回の権限を撤回します。ホストと writer の解放確認後だけ `closed` になります。タイムアウトや不明な外部結果は未解決として残し、lock 削除、他のプロセスの強制終了、無確認の再実行はしません。停止しても原文やメディアを削除せず、別の対話の制御も変更しません。

Codex 接続では最後に完了した同一ネイティブ Thread に `/compact` または `/compact <圧縮後の質問>` を実行できます。公式の圧縮完了イベントが必要で、Codex モデル処理が発生します。新規 Session や手動 Context 削除を圧縮とは数えません。非対応ホストは明示的に拒否します。

プロセス中断後は `cmcp-time project recover --config <entry.json>` が、まず `running`／`cancelling` の作業、所有プロセス、`remoteOutcome`、snapshot を読み取り専用で表示します。対話形式では明示的に選び、非対話形式では `--option <番号> --snapshot <今回の値>` が必要です。所有プロセスの終了を確認できた場合だけ、元の lock を証拠として移し、`interrupted_unknown` を記録して権限を撤回します。外部作業は再送しません。稼働中または状態不明の所有プロセスは拒否します。

## バックアップ、検証、復元

ユーザーバックアップ、工程証拠 ZIP、製品 `.tgz` は別のものです。まず**選択したデータ領域**の writer を通常終了します。他のプロジェクトを閉じる必要はありません。以下はモデルを呼びません。

```text
cmcp-time data inspect --config <entry.jsonまたはruntime.json> --scope <明示した範囲>
cmcp-time data export --config <entry.jsonまたはruntime.json> --scope <明示した範囲> --output <新規バックアップ先> --authorize-backup
cmcp-time data verify --backup <バックアップ先> --scope <同じ範囲>
cmcp-time data restore --backup <バックアップ先> --scope <同じ範囲> --target <新規復元先> --authorize-restore
```

相対パスを含む `runtime.json` は `--project-root <元の設定ルート>` で基準を指定します。先に `inspect` で範囲を確認します。ディレクトリ名だけでは許可を得られません。索引には形式バージョン、範囲、一貫したスナップショット、各ファイルの bytes/SHA-256 を記録します。原文とメディア原本が必須で、一覧や語彙索引はその投影であり代用品ではありません。

復元は新規の空の対象だけを受け付け、既存データに上書き・統合しません。役割、出典ホスト／Session、Pointer／版、原時刻、応答の対応関係、Buffer の元の期限、Pin の対象と完了・取消状態を保持します。期限切れ Buffer は再活性化しません。欠落、ハッシュ不一致、範囲違い、パスの別名は拒否します。無効な画像原本を縮小画像や説明で代替しません。

データ復元は**実行権限の復元ではありません**。既定では共通 OFF、Clean、User/Assistant 保存停止、派送停止になります。鍵、controller capability、一時的 reader ticket、有効 Session 権限、writer lock、モデル grant は引き継ぎません。取り消された作業や撤回された権限は復活しません。受領記録と `data help` に従い、正式な操作で読み取りを明示許可してください。Store JSON を直接編集せず、ホストや通知も自動起動しません。

復元した原本を読むには、共通 `enabled`／`clean` だけを明示的に変更し、許可された出典を一覧表示します。

```text
cmcp-time data controls --config <復元先/runtime.json> --scope <同じ範囲> --enabled true --clean false --authorize-controls
cmcp-time data sources --config <復元先/runtime.json> --scope <同じ範囲> --authorize-reading
```

最初のコマンドは保存、DND、主動、Pin 制御を変更しません。出典一覧には出典番号と現在の選択 token を含む、コピー可能な正式 `read`／`media` コマンドが表示され、Pointer の手入力は不要です。`read` は `--start`／`--end` で分割して読めます。メディア一覧は原本の有界出力に必要な `--image`、`--media-selection`、`--output <まだ存在しない新規ファイル>` を返します。返された選択肢を使い、古い出典版は拒否されます。

`data inspect` と `export` は `--desktop-config <plugin-options.json>` により、選択した範囲の過去の Pin 配送先を保持できます。実行権限は復元しません。復元された active Pin を配送するには、新たな明示的な正式 schedule 操作が必要で、共通スイッチを入れるだけでは配送を許可しません。

容量不足、書き込み拒否、中断、整合性不良は未完了として通知し、失敗した対象と診断を保持します。元のバックアップと既存原本は変更しません。原因を解消してから別の新規対象で再実行します。部分的なフォルダーを成功扱いしたり、回答を切り詰めたり、History や画像を削除して続行したりしません。

## 更新、停止、登録解除

Desktop が生成中・ツール実行中でなく、未送信の作業もないことを確認して通常終了します。操作対象は明示した profile と deployment だけです。

```text
cmcp-time desktop inspect --profile <Desktopのcordis.patch.yml> --deployment-root <CMCP配置先>
cmcp-time desktop help
```

`inspect` は状態、範囲、操作一覧、profile／deployment／旧断片のハッシュを返します。書き込みには直前の `--expected-profile-hash`、ライフサイクル操作にはさらに `--expected-deployment-hash` が必要です。`adopt` は旧 marker なしの登録のモジュールと設定が配置先と一致する場合だけ受け付け、`--expected-legacy-hash` も確認します。所有不明や自有フィールドの変更は拒否します。

`upgrade`（別名 `update`）には `--package-root <検証済みの展開またはインストール先>` と `--expected-package-index-hash <PUBLIC-FILES.jsonのSHA-256>` が必要です。パッケージを検証して配置先の `.cmcp-releases` に保存し、CMCP 自身の登録断片だけを切り替えます。原文、メディア、Buffer、Pin、他のプラグインを上書きしません。トランザクションには前後の断片と出典情報を保持します。

`disable`／`unregister` は自有登録を撤回します。`enable` は登録を戻しますが Session 権限を復活させません。`rollback --transaction <返されたパス>` は一致する自有断片だけを戻し、後で追加された別の設定を保持します。`recovery-required` の場合は `inspect` の後、現在のハッシュで `recover` を実行します。古い profile 全体で上書きしません。失敗した準備ファイルは残し、登録解除でもパッケージやデータを削除しません。

Windows では標準 PowerShell/.NET の `File.Replace` で既存 ACL を保持し、昇格しません。元の公式入口から Desktop を再起動して実際の状態を確認します。ディスク上の登録変更は、起動中プロセスが即座にロード・解除した証拠ではありません。app.asar、モデル、認証情報、ネイティブツール、他の Skills の変更は不要です。

## 対応範囲と証拠の区別

| 層 | 境界 |
| --- | --- |
| Node | 必須 API と過去の可搬性証拠に基づく最低宣言は `22.16.0`。本輪実機は Windows Node `24.18.0`。版文字列の模擬検査は実機検証ではなく、納品互換表で区別します。 |
| 公式 Harness | 既存 `0.2.0-rc.2` の Desktop／SDK 接点が対象。profile と GUI 証拠を分け、SDK にない承認応答を捏造しません。 |
| Codex | 既存アカウントと公式 app-server を使用。被験ホストと工程 Codex の使用量は別で、任意 App Thread の自動接続は保証しません。 |
| メディア | 文書化した範囲で画像・スクリーンショット原本保存と正式読み取りに対応。視覚能力はホスト／モデル経路によります。説明文は画像入力の証拠ではなく、音声・動画は未提供です。 |
| フォローアップ | 明示 Pin、出典権限、DND、取消、重複防止、対象利用可能性の既存ルールに従います。オフライン追送、任意転送、24/7 は保証しません。 |
| 共有 | 同一ユーザー、明示プロジェクト、順次 writer 交代。複数人同時利用やクラウド同期ではありません。 |
| ストレージ | ファイル方式を維持。障害注入契約は別データベースの実装済み証拠ではなく、ベクトルは追加していません。 |

原文の必要条件は、それが実際に制限する行為と対応させて読みます。未指定事項は未指定のままです。Assistant の新しい助言は許されますが、User の決定や実行許可にはなりません。意味、原本、UI、梱包の判定は分けて示します。

## 画像原本、Pin、見える制御

参加済みの公式 Desktop 対話で共有制御と User/Assistant 別々の保存許可を確認します。ネイティブ添付ボタンから PNG/JPEG と自然な説明を送り、改訂画像も別の通常メッセージで送ります。各原本はファイル名、種類、bytes/SHA-256、親 User メッセージ、役割、Session、Pointer/版、原時刻を保持します。説明とサムネイルは原本の代わりではありません。

新しい Session を作り、明示的に `/cmcp on` を実行して両版と元の説明を尋ねます。出典一覧から User 原文を正式に読み、そのメディアを開きます。画像の手動再添付は不要です。原本欠落、失効、版変更は拒否します。視覚理解はホスト/モデルにも依存し、JPEG の取得・比較は限定 Desktop 証拠、PNG 保存は別のオフライン証拠です。全視覚モデル、音声、動画を意味しません。

Desktop データは明示した配備の `state/history`、原本メディアは `media-originals` に保存します。ホスト独自添付はホストの責任です。以下の正式バックアップ/復元を使い、一時添付、サムネイル、製品パッケージを復元可能な History バックアップとみなしません。

フォローには `/cmcp sources` の現在の番号を選び、`/cmcp pin <choice> <offset付きISO時刻|none>` または Pin 画面を使います。`/cmcp pins` の新しい選択肢で `pin-time`、`pin-cancel`、`pin-complete` を実行し、古い番号を別 Session に再利用しません。Pin 作成は自動通知を有効化せず、`none` は未予約です。既存対象と DND を確認してから人が共有制御を明示的に変更します。配信は Desktop 稼働、紐付いた対象の利用可能性、有効な権限が条件です。生成・保存・受理・表示・既読・完了は別状態で、証拠がなければ既読は不明です。

Buffer は既定 12 時間（6–48 時間で設定）、期限切れ/Clear でも History と独立 Pin を保持します。OFF、Clean、保存停止、接続解除は別です。表示変更、一覧/状態確認、正式プレビューは User 原時刻、TTL、配信資格を更新せず、正式読取には通常の読取記録が残る場合があります。共有制御と Session 権限を分けます。

`/cmcp ui minimized`、`row`、`hidden` は表示だけを変更し、非表示でも `/cmcp help` を使えます。保存、登録待ち/失敗、正式読取資格、ホスト間利用の評価状態を分けて表示します。保存メタデータだけでは受信側への引継ぎを評価していません。正式読取とホストの受領記録を別途確認してください。必要な再登録は明示した保護付き操作で行い、閲覧で自動再試行や容量拡大をしません。

## npm 更新とローカル Hook の解除

コードを置換する前に、対象範囲の CMCP writer を正常停止します。prefix と作業領域を維持し、確認した版を同じ prefix に入れ、`--version` を確認してから `cmcp-time update --workspace <workspace>` で setup 管理の Codex 接続を更新します。`update` は npm からダウンロードしません。Desktop は以下の `desktop upgrade` を使います。

`cmcp-time disable --workspace <workspace>` は自動 Hook を停止し手動 Skill を残します。`uninstall --workspace <workspace>` は外部変更のない管理 Skill も解除します。どちらも History・設定・受領記録を残します。npm プログラムの削除は別の明示操作であり、作業データ削除の許可ではありません。外部変更は競合として扱い、古い設定全体で上書きしません。

## 任意の MCP と Hermes

MCP は npm shrinkwrap で `@modelcontextprotocol/sdk` 1.32.0、`zod` 4.6.5、`jose` 6.2.12 を固定しています。通常の npm 導入には依存が含まれ、ソースでは `npm ci` を実行します。`node_modules` のない Desktop コピーを依存導入済みサービスとは扱いません。ローカル機能は常駐 MCP を必要としません。

`mcp init` で明示した永続プロジェクトを作り、`mcp check`、`health`、`capabilities` で確認します。`mcp start` は前景実行、`mcp stop` は正常停止です。HTTP は既定 loopback。遠隔利用には audience/scope 認証、TLS または信頼した逆プロキシ、Host/Origin 確認が必要です。標準 JWT 検証は OAuth サーバーではなく、OAuth のみのプラットフォームには対応する認可層が別途必要です。モデルには読取ツールのみを渡し、controller や User イベント偽造権限を渡しません。一つの正式 writer が複数 client を扱い、多人数分散所有権や無期限稼働は提供しません（サービス寿命は既定 12 時間）。

Hermes は外部依存で、公式 `v2026.9.24`、commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`、パッケージ 0.21.5 が対象です。隔離 Python 3.11–3.13（実行済み 3.12.14）、同梱の固定 requirements、公式ソースの editable インストールを使います。通常 wheel 経路は検証済みではありません。Windows ネイティブツールには Git Bash（可搬版 2.56.0.windows.1 で確認）も必要で、子プロセス環境だけに設定し全体 PATH を変更しません。許可済みの既存 DeepSeek 資格情報は参照し、コピーや値のコマンド引数化をしません。`hermes configure` は依存を導入しません。[相互接続ガイド](interop.ja.md)と[依存再構築](../adapters/hermes/dependencies.md)を参照してください。

Hermes/Harness peer は `--synthetic-evidence` 必須で、合成試験の完全な証拠を記録します。私的な日常 profile ではありません。公式 Hermes ヘッドレス経路と隔離 Harness SDK の検証であり、新規 Desktop GUI やクラウドの検証ではありません。Hermes の日常追加診断は既定で metadata のみです。ネイティブ履歴と CMCP History は別管理。取消は正式解放まで stopping となり、送信済みの供給元リクエストが即座に停止する保証はありません。
