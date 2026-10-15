# CMCP-TIME 0.1.1 — GitHub-only

[English](#english) · [繁體中文](#繁體中文) · [Español](#español) · [日本語](#日本語)

## English

This formal increment contains the cumulative S1/S1-R1 source-preserving continuity work and four scoped maintenance fixes. It retains Apache-2.0, redwakame attribution and the upstream notices. It adds no new host integration or model provider.

Install the [0.1.1 runtime tarball](https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz) from the [formal Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1). The [tagged source](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) includes tests; the runtime tarball includes the declared execution closure. These archives have different contents and hashes. **npm is not updated by this release:** npm 0.1.0 and its tags remain unchanged. `private:true` protects this source against accidental npm publication; it does not prevent installation from the GitHub tarball.

```sh
npm install --prefix ./cmcp-0.1.1 https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz
node ./cmcp-0.1.1/node_modules/@redwakame-skill/cmcp-time/bin/cmcp-time.mjs --version
```

Choose a persistent installation directory. Follow the [setup and update guide](npm-installation.md) for an explicitly authorized workspace. Installing files does not attach a host, grant model usage, import private history or enable proactive delivery. Codex is optional. Backup/restore and detachment retain their existing separate responsibilities.

Changes and evidence limits:

- Plans, reported facts, scoped revisions, retained conditions and stated reasons use formal sources and bounded continuity projections. Structure, provenance, semantic evidence and execution authorization remain separate. Earlier named-host tests are carried forward where implementation/contracts are unchanged; no new product-model call is made for this release.
- Setup handles TTY input and EOF explicitly. Noninteractive input without `--answers` fails before writing; batch stdin is not supported. Without Codex selected, setup neither probes nor starts it, and its binding status is not the whole CMCP status.
- The H4 maintenance run preserved all three specified reports and supplied complete projection pages in a normal **new** Harness Session. That run did not exercise the resolution branch; 13 fixed-source checks cover that branch. The additional r8 assistant source did not reach the model, so this is neither all-selected READ-ALL nor a replay of the original intermediate turn.
- The existing C27 cases 163/236 still exceed the bounded material budget. Their FAIL evidence and limits are retained; no tests are skipped and no capacity limit is raised for release.
- Proactive status distinguishes configuration, effective executor, connected delivery and eligible candidates. First use stays OFF. A retained 60-second inactivity value does not promise automatic delivery; the connected Harness delivery path remains explicit Pins.
- A stale duplicate receipt reference was corrected. The old `be087644…` full-text preimage was not found; historical full-text equivalence is not claimed.

This increment was exercised on Windows with Node 24.18.0; declared Node >=22.16.0 is retained. Earlier Linux results do not establish this entire increment on Linux. Public installation and file integrity checks do not certify all host semantics. Dots/Muse/Grok Bot lifecycle additions, broad cloud operation, general proactive policy, vector retrieval and 24/7 agents are not included. See the [roadmap](roadmap.md), [source test instructions](testing.md) and Release hash/source mapping. Historical candidate/verification files listed by `RELEASE-IDENTITY.json` are not current publication receipts.

## 繁體中文

本正式增量納入 S1／S1-R1 的累積原文接續成果及四項限定維護，保留 Apache-2.0、redwakame 署名與合法上游沿革；沒有新增宿主接線或模型供應商。

從[正式 Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1)取得 [0.1.1 執行套件](https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz)，或查看[固定 tag 來源](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1)。來源包含測試，tgz 包含宣告的執行檔與相依責任，兩種壓縮檔內容／雜湊不同。**npm 本次不更新：**npm 0.1.0 及其標籤保持；`private:true` 防止誤發布 npm，不影響 GitHub tgz 安裝。

使用上方兩行安裝／版本命令，選持久目錄，再依[設定與更新指南](npm-installation.md)明確選擇授權工作區。安裝不自動接入宿主、授權模型、匯入私人歷史或啟用主動；Codex 不是必要依賴。備份還原、停用與解除接線保持既有分工。

- 計畫、回報事實、局部修訂、其餘維持與明說理由由正式來源及有界接續投影處理；結構、來源、語意證據與執行授權分列。相關程式／契約未改的具名宿主證據沿用，本發布單沒有新增產品模型呼叫。
- 初始化明確處理 TTY／EOF；非互動未給 `--answers` 會在寫入前拒絕，不支援批次 stdin。未選 Codex 不探測、不啟動，不以其 binding 狀態代替 CMCP 全部狀態。
- H4 真 Harness **新 Session** 已保留三項指定回報，完整投影頁面已供給模型。該輪沒有走 resolution 分支；分支另由固定原件 13 項驗證。額外 r8 助理來源未進模型，不稱全選取 READ-ALL，也不是原中間回合重演。
- C27 163／236 仍超出有界材料預算；原 FAIL 與限制保留，未刪測試、skip 或放寬容量。
- 主動狀態分清配置、有效執行器、送達入口與合格候選，首次仍 OFF。保留的 60 秒閒置值不代表必定發送；Harness 已接送達仍限明確 Pin。
- 回執重複引用漏同步已更正；舊 `be087644…` 正文完整前像未找到，不宣稱歷史全文等價已證明。

本增量現場為 Windows／Node 24.18.0，保留最低 Node >=22.16.0 宣告；較早 Linux 結果不代表本增量全數在 Linux 已驗。公開安裝與檔案核對不等於全部宿主語意認證。Dots／Muse／Grok Bot 新生命週期、全面跨雲、一般主動策略、向量及全天候代理未納入。請見[路線](roadmap.md)、[來源重跑](testing.md)及 Release 外置雜湊／來源對照。`RELEASE-IDENTITY.json` 所列舊候選與驗證檔只作歷史，不是本版上傳回執。

## Español

Esta versión formal reúne el trabajo acumulado S1/S1-R1 de continuidad con fuentes originales y cuatro correcciones de mantenimiento. Conserva Apache-2.0, la autoría de redwakame y los avisos de procedencia. No añade proveedores ni integraciones de hosts.

Obtenga el [paquete ejecutable 0.1.1](https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz) de la [Release formal](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1). El [código con etiqueta fija](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) incluye las pruebas; el tgz contiene los archivos declarados para ejecutar. Sus contenidos y hashes son distintos. **npm no se actualiza:** permanecen 0.1.0 y sus etiquetas. `private:true` evita una publicación accidental en npm, sin impedir instalar el tgz de GitHub.

Use los dos comandos de instalación y versión de arriba en un directorio persistente; siga la [guía de configuración y actualización](npm-installation.md) para elegir un espacio autorizado. Instalar no conecta hosts, autoriza modelos, importa conversaciones privadas ni activa envíos proactivos. Codex es opcional. Copia/restauración y desconexión conservan sus responsabilidades separadas.

- Planes, hechos comunicados, cambios parciales, condiciones conservadas y motivos declarados se apoyan en fuentes formales y proyecciones acotadas. Estructura, procedencia, evidencia semántica y permiso de ejecución son distintos. Se reutiliza evidencia de hosts cuando código y contratos no cambian; esta publicación no añade llamadas a modelos del producto.
- La configuración trata explícitamente TTY y EOF. Sin `--answers`, una entrada no interactiva se rechaza antes de escribir; no se admite stdin por lotes. Sin elegir Codex, no se busca ni inicia, y su estado de enlace no representa todo CMCP.
- H4 conservó los tres informes especificados y suministró todas las páginas de proyección en una **nueva** sesión normal de Harness. Esa ejecución no recorrió resolution; 13 comprobaciones con fuentes fijas cubren esa rama. r8 no llegó al modelo: no es READ-ALL de toda la selección ni repetición del turno intermedio original.
- C27 163/236 continúa excediendo el presupuesto acotado. Se conservan los FAIL y sus límites, sin omitir pruebas ni ampliar capacidad.
- El estado proactivo separa configuración, ejecutor efectivo, entrega conectada y candidatos elegibles. Inicialmente OFF; 60 segundos de inactividad no prometen un envío. Harness sigue entregando solamente Pins explícitos.
- Se corrigió una referencia duplicada desactualizada. No se encontró el texto anterior completo de `be087644…`; no se afirma equivalencia textual histórica.

La evidencia de este incremento corresponde a Windows/Node 24.18.0; se conserva Node >=22.16.0 como mínimo declarado. Resultados Linux anteriores no certifican todo este incremento. La instalación pública no prueba toda la semántica. No incluye nuevas conexiones Dots/Muse/Grok Bot, operación general entre nubes, políticas proactivas generales, vectores ni agentes 24/7. Consulte la [hoja de ruta](roadmap.md), las [pruebas](testing.md) y los hashes/mapas externos de Release. Los registros históricos enumerados en `RELEASE-IDENTITY.json` no certifican la publicación actual.

## 日本語

この正式更新は、原文に基づく S1／S1-R1 の累積成果と、範囲を限定した四つの保守修正を含みます。Apache-2.0、redwakame の著作者表示、上流の告知を維持し、新しいホスト接続やモデル提供元は追加しません。

[正式 Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) の [0.1.1 実行用 tgz](https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz) を利用してください。[固定タグのソース](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) はテストを含み、tgz は宣言された実行ファイルを含むため、内容とハッシュは異なります。**今回は npm を更新しません。** npm の 0.1.0 とタグはそのままです。`private:true` は誤った npm 公開を防ぐ設定で、GitHub tgz のインストールは可能です。

上記の二つのインストール／バージョン確認コマンドを永続ディレクトリで実行し、[設定・更新手順](npm-installation.md)で許可するワークスペースを選びます。インストールだけではホスト接続、モデル利用許可、個人履歴の取り込み、能動送信は行いません。Codex は任意です。バックアップ／復元、無効化、接続解除の責任は従来どおり分離します。

- 計画、報告された事実、部分修正、維持される条件、明示された理由を正式ソースと有界投影で扱います。構造、出典、意味の検証、実行許可は別です。変更されていないコード／契約のホスト証拠は引き継ぎ、本公開では製品モデルを追加呼び出ししません。
- TTY と EOF を明確に処理します。非対話入力で `--answers` がなければ書き込み前に拒否し、一括 stdin は非対応です。Codex を選ばなければ探索／起動せず、その接続状態を CMCP 全体の状態と混同しません。
- H4 は通常の**新規** Harness セッションで指定された三つの報告を保持し、投影の全ページをモデルへ供給しました。この実行では resolution 分岐を通っておらず、分岐は固定原件による 13 項目で別途検証しています。追加の r8 はモデルに届いていないため、全選択 READ-ALL や元の中間ターンの再演とは呼びません。
- C27 163／236 は既存の材料予算を超えます。FAIL と制限を保持し、テストの削除／skip／容量緩和はしません。
- 能動状態は設定値、実際の実行器、接続済み配送経路、適格候補を分けます。初期は OFF。60 秒の無操作値は送信を保証せず、Harness の配送は明示 Pin に限定されます。
- 重複した古い受領参照を訂正しました。`be087644…` の旧本文全体は見つからず、過去の全文同一性を証明したとは主張しません。

今回の実機証拠は Windows／Node 24.18.0 で、最低宣言 Node >=22.16.0 は維持します。過去の Linux 結果で今回の全機能を検証済みとはしません。公開インストール確認は全ホストの意味検証ではありません。Dots／Muse／Grok Bot の新接続、全面的なクラウド間運用、一般能動方針、ベクトル、24/7 エージェントは含みません。[ロードマップ](roadmap.md)、[テスト手順](testing.md)、Release の外部ハッシュ／ソース対応表を参照してください。`RELEASE-IDENTITY.json` に列挙した過去の候補記録は現在の公開受領書ではありません。
