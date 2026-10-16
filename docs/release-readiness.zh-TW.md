# CMCP-TIME 0.1.1：正式操作指南

[English](release-readiness.en.md) · [繁體中文](release-readiness.zh-TW.md) · [Español](release-readiness.es.md) · [日本語](release-readiness.ja.md)

本指南說明 **0.1.1**；保留既有檔名以維持連結。請以通道、套件雜湊、來源提交與 `PUBLIC-FILES.json` 核對成品；相同版號或可變標籤不代表 GitHub 與 npm 包位元組相同。原作者 redwakame，Apache-2.0，保留 LICENSE 與 NOTICE。

使用下列命令安裝固定 npm 版本 **`@redwakame-skill/cmcp-time@0.1.1`**，再核對 `--version`。先前的 [GitHub-only v0.1.1 Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) 與固定 tag 保持原樣，原 tgz 與 npm 包是不同成品。npm 後續來源只調整發布設定與文件，不更換 Runtime。見[安裝與來源身分](npm-installation.md#version-and-publication-evidence)及[歷史更新與證據限制](release-0.1.1.md)。

## 持久安裝與獨立工作區

先準備 Node.js >=22.16.0 與 npm。最新互通增量實跑 Windows Node 24.18.0；先前 Linux／22.16.0 測試不代表新增功能已全面跨平台驗收。程式 prefix 與已存在的持久工作區分開；History 不放在 `node_modules`，永久 Hook 不綁 `npx` 快取。

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-0.1.1'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

`setup` 詢問保存範圍、語言、時區與選配 Codex 接線，不代裝宿主、不匯入私人歷史、不授予付費呼叫或主動派送。POSIX 執行檔在 `<prefix>/node_modules/.bin/cmcp-time`，Windows 在 `<prefix>/node_modules/.bin/cmcp-time.cmd`；後續範例請替換成自己的完整執行檔，不假設已改 PATH。來源使用者可用 `node bin/cmcp-time.mjs`，先 `npm ci` 裝妥選配 MCP 的鎖定相依。詳見[安裝指南](npm-installation.md)。

受管理的本機 Codex Hook 須核對精靈產出的專案並完成原生核准。官方 Harness Desktop 是另一個宿主，npm setup 不會自動建立它的部署；已有 CMCP Desktop 部署者依下文查核 profile 與生命週期操作。只有程式副本不等於完整接線。

### 0.1.1 維護：互動輸入與選配 Codex

下列修正納入兩個 0.1.1 通道；先前已發布的 npm 0.1.0 套件保持原樣。`setup`／`update` 不帶 `--answers` 時須在終端機（TTY）逐題回答；批次管線或空 stdin 會在寫設定前拒絕，途中 EOF 會取消，缺答不等於同意。自動化請先依 `examples/setup-host.json` 明確填妥自己的選項，再執行 `cmcp-time setup --workspace <既有工作區> --answers <工作區內的 answers.json>`。不使用 Codex 時選 `attachCodex: false`；不用安裝或啟動 Codex。

`setup --status` 保留相容的 `state`／`cmcp_codex_binding`，但 `stateScope=managed_codex_hook_binding` 明示它只代表 Codex 接線。請分別查看 `layers.configuration`、`layers.hostConnection`、`layers.runtime` 與 `layers.sources`：已設定、宿主接線、有效控制、原件保存與正式可讀資格是不同狀態。其他宿主未經查核會顯示 `not_inspected`；reader 資格不代表模型已讀取。`disable` 只停用受管理的 Codex 接線，保留 Runtime 控制與 History；以原生非 Codex 入口使用時仍須自己的有效授權。

### 0.1.1 維護：按需整理目前狀態

在已授權對話自然要求「整理目前狀態」即可，由宿主使用既有正式工具完成，不必手寫 JSON。若 `partial` 回傳來源用途 finding，宿主須先核對完整原訊息，再依目前 `finding.requiredResolutionKind` 及正式 `finding.report.source.ref` 處理；`reportRef` 不能拿 `nodeId` 代替。若回傳分頁，沿同一結果的 `delivery.nextPage` 續讀直到 `complete`，不要重送 proposal 冒充下一頁。來源缺件或真正歧義仍保留 `partial`；結構／來源處理 `ready` 不等於語意已驗通過，也不授予執行權限。

本次 H4 維護驗收已分清三項明示回報與暫停指令，所得投影的全部頁面均已供給。正常宿主選用精確引文區間；明示來源用途 resolution 另由固定原件正反例核對。投影完整不代表選定的全部原文已送達模型：額外選入的一段助理長答未讀，因此整體覆蓋仍正確顯示 `partial`。較早的 C27 兩個大型材料案例仍超過 65,536 bytes，屬已知容量限制，未宣稱全量通過。詳見 [0.1.1 證據界線](release-0.1.1.md)。

## 第一次接入官方 Desktop

沿已安裝官方 Desktop，不另開舊 Web launcher。先確認沒有生成、工具或未送出工作，正常退出 Desktop。從既有正常設定入口查明實際安裝根與設定 profile，不猜另一份 SDK 或舊部署的路徑。

`<official-llm-module>` 為查明的官方安裝根加上 `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js`。這是 Electron ASAR 虛擬路徑，一般 Node 檔案查詢可能看不到內部檔案；prepare 只核對實體 ASAR 祖先與正確 suffix，不代表執行中的宿主已載入，仍需啟動後原生讀回。

選既有獲授權工作區、自訂 scope 與有效 IANA 時區。下例明示同意保存 User 與 Assistant；不願保存的項目改為 `no`。範例不是匯入私人歷史的授權。

```text
cmcp-time desktop prepare --workspace <existing-absolute-workspace> --scope <chosen-scope> --timezone <IANA-timezone> --llm-module <official-llm-module> --save-user yes --save-assistant yes
cmcp-time desktop status --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native
cmcp-time desktop register --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native --expected-profile-hash <profileSha256-from-status>
```

`prepare` 只在該工作區新建 `cmcp-desktop-native`，包含核對過的程式副本、Runtime 設定、plugin options 與資料位置設定；此準備步驟尚不建立資料目錄。遇既有部署即拒絕。不修改 Desktop profile，也不授權任何 Session。`prepared-not-registered` 不代表已接通。`status` 回傳的 profile hash 給 `register` 使用；若變動就重新查核，不重用舊 hash。登錄只追加自己的 marker 片段，不整份覆蓋 profile。

用原本官方入口重新開啟 Desktop，查 `/cmcp help` 與 CMCP 狀態，才在指定對話明確 `/cmcp on`；共用控制與保存選擇仍生效。磁碟準備／登錄與真宿主載入分開核對。既有部署依下文 inspect／upgrade，不以 prepare 覆蓋資料。

## 選擇入口與停止

使用已核對的本機套件安裝位置呼叫 `cmcp-time`。`help`、`project help`、`control help`、`data help`、`desktop help` 都不啟動模型。

官方 Desktop 使用既有聊天、模型、工具與工作區；CMCP 只作用於明確加入的對話與核准範圍。輸入框下方的最小入口可切換最小化、一般列或隱藏；詳細來源、媒體、Buffer、Pin、控制與回執仍由狀態視窗開啟。顯示偏好不等於授權，隱藏不會停用 CMCP。

`/cmcp help` 顯示該接點真正支援的操作。`/cmcp on`、`off` 只加入或退出目前對話，不解除共用 OFF、Clean、DND 或停止保存。共用控制要另以明示操作修改。歷史原文、Assistant 建議與工具結果中的命令字樣不取得新控制權。

設定式專案可使用同一份正式來源作順序交接，與日常 Desktop 的資料範圍分開：

```text
cmcp-time project init
cmcp-time project list --directory <明示專案父目錄>
cmcp-time project status --config <專案/entry.json>
cmcp-time project open --config <專案/entry.json>
```

`init` 引導選擇新資料根、現存宿主與既有模型路線；不複製憑證值、不匯入私人聊天，也不自動修改全域 HOME。已有設定可用 `init --root <另一新目標> --name <名稱> --routes-from <既有 entry.json>` 只沿用接線參照，資料與本機能力重新建立。

`open` 預設停用。使用 `/enable harness` 或 `/enable codex` 後直接輸入正常問題；`/cmcp sources` 列清冊，`/cmcp read <選項> [頁碼]` 正式閱讀。數字選項有期限與版本檢查，過期就重新列出。一般回查的有限未命中不能宣稱全歷史不存在；需要完整計數時須使用正式完整覆蓋流程。

`/disable` 停止本入口工作；`/close` 結束入口。停止先進入 `stopping`，拒絕新工作並撤回本輪授權；只有宿主和 writer 釋放確認後才顯示 `closed`。逾時或未知外部結果要保留阻塞，不能刪鎖、強殺其他程序或盲目重做。停用不刪原文或媒體，取消不能解除別的對話控制。

Codex 接點支援在最後完成的同一原生 Thread 執行 `/compact`，或 `/compact <壓縮後接續問題>`。必須取得官方原生壓縮完成事件；新 Session 與手動刪 Context 不算壓縮。此操作會啟動 Codex 模型工作；不支持的宿主明示拒絕。

非正常中斷後用 `cmcp-time project recover --config <entry.json>` 查看待處理工作、owner、未知外部結果與當次快照。互動模式可選擇待處理項；非互動需另給 `--option <數字> --snapshot <本次值>`。只有能確認原 owner 已退出，才沿正式恢復把原鎖移存為證據、標記 `interrupted_unknown` 並拒絕舊票券；不重送外部工作。活躍或無法確認的 owner 保持阻擋，不能手動刪鎖。

## 備份、驗證與還原

使用者備份、工程證據 ZIP 與產品 `.tgz` 是三種不同檔案。先正常停止**選定資料區**的 writer；不需關閉其他專案。以下操作不呼叫模型：

```text
cmcp-time data inspect --config <entry.json 或 runtime.json> --scope <明示範圍>
cmcp-time data export --config <entry.json 或 runtime.json> --scope <明示範圍> --output <不存在的備份目錄> --authorize-backup
cmcp-time data verify --backup <備份目錄> --scope <同一範圍>
cmcp-time data restore --backup <備份目錄> --scope <同一範圍> --target <不存在的還原目錄> --authorize-restore
```

直接使用相對設定的 `runtime.json` 時，可用 `--project-root <該設定的原根目錄>` 明示解析根。先以 `inspect` 確認資料範圍；不依目錄名稱猜授權。備份格式版本、成員 bytes／SHA-256、scope 與一致快照版本都寫入索引。資料與媒體原件是必要內容；清冊與詞彙索引是指向原件的投影，不能取代原件。

還原只接受新的空目標，不覆寫或合併既有資料。成功後保留原角色、來源宿主／Session、Pointer／版本、原時間、reply 關聯、Buffer 原期限及 Pin 目標／完成／取消狀態。過期 Buffer 不會因還原重新活化。原件缺失、雜湊不符、scope 不同或路徑別名會拒絕；不能拿舊縮圖或描述代替有效原圖。

恢復資料不恢復執行權：預設共用 OFF、Clean、停止 User／Assistant 保存及派送；不匯入帳戶金鑰、controller capability、短期閱讀票券、活動 Session 授權、writer 鎖或模型 grant。舊取消與撤權不因備份而復活。依回執及 `data help` 的正式命令明示恢復可用閱讀控制；不能直接修改 Store JSON，也不會自動配置宿主或開始提醒。

還原後的零模型閱讀操作：

```text
cmcp-time data controls --config <還原/runtime.json> --scope <同一範圍> --enabled true --clean false --authorize-controls
cmcp-time data sources --config <還原/runtime.json> --scope <同一範圍> --authorize-reading
```

第一條只明示修改 `enabled`／`clean`，不修改保存、主動、Pin 或 DND。清冊提供可直接使用的 `data read`／`data media` 命令，包含人類編號與當次 `selection`，不需找內部 ID。原文以 `--start`／`--end` 分頁；媒體清冊提供 `--image`、`--media-selection` 及 `--output <不存在的新檔案>` 的匯出命令。授權或來源已變就重新核對，不能拿舊選項避開控制。

備份原生 Desktop 資料時，`inspect`／`export` 可加 `--desktop-config <CMCP plugin-options.json>`，保留同 scope 的歷史 Pin 派送位置，不複製原生對話或執行權。還原的 active Pin 顯示需要重新授權；僅開共用主動／Pin 開關仍不派送，須經既有正式排程操作給予新的明示授權。已完成／取消的狀態保持。

容量不足、寫入拒絕、中途終止或完整性失敗時，回報未完成，保留失敗目標及診斷。原備份與既有來源不動；處理原因後另選新目標重試。不要將部分目錄當成成功，不截短回答、丟棄舊 History 或刪原圖換取繼續。

## 更新、停用與撤回登錄

先確認 Desktop 沒有生成中、執行工具或未送出的工作，再正常退出。`desktop` 命令只操作明示的設定檔與部署，不尋找或接管其他帳戶的同名外掛：

```text
cmcp-time desktop inspect --profile <Desktop cordis.patch.yml> --deployment-root <CMCP 部署根>
cmcp-time desktop help
```

`inspect` 回傳現有狀態、可用操作、profile／部署／舊片段雜湊。寫入必須帶當次讀回的 `--expected-profile-hash`；生命週期操作另需 `--expected-deployment-hash`。舊無 marker 登錄只有證明指向同一部署與設定後才可 `adopt`，並帶 `--expected-legacy-hash`。未知所有權或同欄位漂移一律停止。

`upgrade`（同義 `update`）另帶 `--package-root <已核對的解包或安裝根>` 與 `--expected-package-index-hash <PUBLIC-FILES.json SHA-256>`。新程式保存在部署內版本目錄，只切換 CMCP 自有登錄片段，不覆蓋原文、媒體、Buffer、Pin 或其他外掛。交易回執保留前後片段與來源對照。

`disable`／`unregister` 撤回本套件登錄；`enable` 重新登錄但不恢復 Session 授權。`rollback --transaction <本次回傳的交易路徑>` 只回復相符的自有片段，保留使用者後加設定。中途失敗顯示 `recovery-required` 時先 `inspect`，再依 `help` 以 `recover` 處理已核對狀態；不要整份覆蓋舊 profile。失敗準備檔保留。解除登錄不刪套件、History 或媒體。

完成後從原官方入口重新開啟 Desktop。磁碟登錄成功不等於已開啟的程序即時載入／卸載；要讀回實際狀態。沒有修改官方 app.asar、模型、憑證、原生工具或其他 Skills。

## 支援範圍與限制

| 層級 | 界線 |
| --- | --- |
| Node | 宣告 `>=22.16.0` 依現用 API 與既有可攜證據；本輪實機為 Windows Node 24.18.0。版本字串模擬不是最低版實跑。以交付相容矩陣區分本輪與歷史結果。 |
| 官方 Harness | 與已安裝 `0.2.0-rc.2` 的 Desktop／SDK 接點相容；兩種 profile 與 GUI 證據分列。SDK 沒有的原生核准回傳不能假造。 |
| Codex | 沿既有帳戶與正式 app-server；被測宿主與工程 Codex 分列。不能宣稱任意 App Thread 自動接入。 |
| 媒體 | 已交付圖片／截圖原件保存與正式閱讀；模型視覺能力依宿主路線，不能把描述當成模型看過圖片。音訊、影片尚未交付。 |
| 主動跟進 | 只沿既有明確 Pin、來源授權、DND、取消、去重與目標可用規則；不承諾離線補發、任意轉送或 24/7。 |
| 跨宿主 | 同一使用者、明示專案、順序 writer 交接；不等於多人並行或雲端同步。 |
| 儲存 | 保留檔案後端；故障注入與替身契約不代表新資料庫後端已部署。未加入向量。 |

來源支持的必要條件要與所限制的動作一起閱讀。其他動作未定時保持未知；Assistant 可以提供新建議，但建議不因此成為 User 的決定或執行授權。模型語意驗收與來源／介面／封裝驗收分項回報。

## 圖片原件、Pin 與可見控制

在已加入的官方 Desktop 對話確認共用控制與分開的 User／Assistant 保存授權。從原生附件按鈕送出 PNG／JPEG 並附自然說明；修訂圖再以一般訊息提交。每個原件保留檔名、媒體類型、bytes／SHA-256、父 User 訊息、角色、Session、Pointer／版本及原時間；描述與縮圖不取代原件。

建立新 Session、明確 `/cmcp on`，自然詢問兩版及各自原說明。由來源清冊正式讀取 User 原文，再開該來源的媒體預覽，不需手工重貼圖片。缺件、撤權或變版明確拒絕。視覺理解另受宿主與模型支援限制：JPEG 取回與比較有原生 Desktop 限定證據，PNG 保存另有離線證據；不代表所有視覺模型、音訊或影片已支援。

Desktop 資料位於明示部署的 `state/history`，原件在其 `media-originals`；宿主原生附件仍由宿主管理。備份還原使用下文正式資料命令；暫存附件、縮圖副本或產品套件不是可還原的 History 備份。

需要跟進時先 `/cmcp sources`，選目前清單編號，再用 `/cmcp pin <選項> <含offset的ISO時間|none>` 或 Pin 分頁。以 `/cmcp pins` 回傳的新選項執行 `pin-time`、`pin-cancel`、`pin-complete`，不把舊選項帶到新 Session。建立 Pin 不會開啟主動總開關；`none` 就不排程。先查既有目標與 DND，才由人明確修改共用開關。站內派送限官方 Desktop 運行、原綁定目標可用且授權有效；生成、保存、接受、呈現、已讀與完成分列，缺少已讀證據即未知。

Buffer 預設 12 小時，可設 6–48 小時；到期／Clear 保留 History 與獨立 Pin。OFF、Clean、停止保存、解除接線各有語意。顯示切換、清冊／狀態查看及正式預覽不刷新 User 時間、TTL 或派送資格；正式閱讀可留下既有閱讀回執。共用控制與 Session 授權維持分開。

Setup 保留低層 `loopTiming` 相容值：TTL／閒置／活動窗分別為 600000／60000／600000 毫秒。正式 Runtime 設 `externalDispatch:true`、使用共用派送器，保留的本機閒置計時器未啟用，**不代表 60 秒沒活動就會發送**。排程依合格 Pin 的 `dueAt` 或受支持 Buffer 的原期限，仍須通過目前控制、DND、來源、取消、去重及已授權送達目標檢查。目前官方 Harness 路線只接明確 Pin；主動共用開關首次 OFF。狀態分列配置、執行器、實際觀測與宿主送達限制；未觀測到執行器不能稱已確認停機。詳見[設定說明](configuration.md#timing-values-and-the-effective-proactive-executor)。

`/cmcp ui minimized`、`row`、`hidden` 只改顯示，隱藏後仍可 `/cmcp help`。狀態分列已保存、登錄待辦／失敗、目前正式可讀及跨宿主評估狀態。單憑儲存狀態未評估接收端交接，須另查正式閱讀與宿主回執。需要補登時走明示受控重試，查看不自動重試或擴容量。

## 程式更新與本機 Hook 解除

替換程式前先正常停止該範圍 CMCP writer，保留原 prefix 與工作區。把審閱過的目標版本裝進同一 prefix、核對 `--version`，再以 `cmcp-time update --workspace <workspace>` 更新精靈管理的 Codex 接線；`update` 不下載 npm 程式。Desktop 另依下文 `desktop upgrade`。

`cmcp-time disable --workspace <workspace>` 停受管理自動 Hook、保留手動 Skill；`uninstall --workspace <workspace>` 再解除未被外部修改的受管理 Skill。兩者都保留 History、設定與回執；npm 程式移除是另一次明確操作，不代表可刪工作區。外部修改造成衝突時，不把整份舊設定覆蓋回去。

## 選配 MCP 與 Hermes

MCP 透過 npm shrinkwrap 固定 `@modelcontextprotocol/sdk` 1.32.0、`zod` 4.6.5、`jose` 6.2.12；正常 npm 安裝包含相依，來源 checkout 先執行 `npm ci`。不含 `node_modules` 的 Desktop 程式副本不是已裝齊相依的服務。既有本機模式不要求 MCP 常駐。

`mcp init` 建立明示持久專案；`mcp check`、`health`、`capabilities` 查核，`mcp start` 前景運行，`mcp stop` 正常停止。HTTP 預設 loopback；遠端另需明示 audience／scope 認證、TLS 或可信反向代理及 Host／Origin 核對。標準 JWT 驗證不是 OAuth server，僅接受 OAuth 的平台另需相容授權層。模型只拿唯讀工具，不拿 controller 或偽造 User 事件的權限。同一正式 writer 服務多 client，不代表多人分散式所有權或無限常駐，服務預設生命週期上限為 12 小時。

Hermes 是外部相依：官方 `v2026.9.24`、commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`、套件 0.21.5。使用獨立 Python 3.11–3.13（實跑 3.12.14）、隨附鎖定相依與官方 source editable 安裝；一般 wheel 路線未驗通過。Windows 原生工具另需 Git Bash（實跑可攜 2.56.0.windows.1），只設子程序，不改全域 PATH。既有獲授權 DeepSeek 憑證只存參照，不複製或填入命令參數值；`hermes configure` 不代裝這些相依。完整命令及重建：[互通指南](interop.zh-TW.md)、[Hermes 相依](../adapters/hermes/dependencies.md)。

Hermes／Harness peer 命令明確限 `--synthetic-evidence` 合成驗收，會記完整合成證據，不是私人日常 profile。真實驗收是官方 Hermes 無 UI 生命週期與隔離 Harness SDK，非新 Desktop GUI 或雲端部署。日常 Hermes 額外診斷預設只記 metadata；原生歷史與 CMCP History 各自負責。取消在正式釋放前顯示 stopping；已送供應商請求不保證立即停止。
