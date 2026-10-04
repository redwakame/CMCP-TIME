# 設定式專案入口

這是官方 Harness SDK 與 Codex app-server 的薄接線，重用正式 shared-project broker、Core 原文保存與來源工具。入口管理程序的啟動、停止及目前選擇；不另建聊天記憶、回答模型或 Core 狀態機。程式不含特定使用者、工單日期、專案資料根、固定模型或供應商憑證值。

公開 API 為 `runProjectCli(args)`，供套件 `project` 子命令呼叫；匯入本模組不啟動宿主。程式介面為 `createProjectController({configFile,onEvent})`，回傳 `status/enable/ask/askFile/compact/respond/control/disable/close/select`。host/route 與資料根始終取自明示設定。

## 人類操作

`cmcp-time project init` 以互動引導建立新專案：輸入新資料根與名稱、現存宿主執行檔／官方 SDK CLI、既有 provider 與 model 名稱、憑證檔參照及 reference 名稱。既有憑證值由官方 credentials 模組讀取，入口不解析或複製；只為新專案產生本機 IPC capability。Windows private 目錄限目前使用者與 SYSTEM；同 Windows 使用者的任意程序仍不是隔離沙箱。

所有欄位也能用 flags 輸入，不需手寫 JSON：

```text
cmcp-time project init --root <新資料根> --name <專案名稱> --codex-executable <現存Codex執行檔> --harness-executable <現存Harness執行檔> --harness-cli <官方SDK-cli.js> --credential-file <既有憑證參照檔> --credential-reference <既有reference> --provider <既有provider> --model <既有model>
```

可選 `--reasoning-effort`、`--timezone`；程式不自動修改宿主模型或權限。已建立第一個專案後，另建新專案可以只沿用其接線參照，資料與 IPC capability 重新建立：

```text
cmcp-time project init --root <另一新資料根> --name <另一專案名稱> --routes-from <既有專案/entry.json>
cmcp-time project list --directory <明示的專案父目錄>
cmcp-time project status --config <選定專案/entry.json>
cmcp-time project open --config <選定專案/entry.json>
```

`list` 只查看指定父目錄下一層，不掃描家目錄或私人 Session。`init` 拒絕已存在的資料根；中途失敗的檔案保留，不覆寫或刪除。自動產出的 `entry.json`、`shared-project.json`、`runtime.json` 是設定檔，不要求人類編輯。工具整合若已有結構化設定，也可用 `init --spec <設定檔>`。

進入 `open` 後預設停用；輸入：

```text
/enable harness
你的正常問題直接寫在這裡，不需 prompt-file。
/status
/cmcp help
/cmcp sources
/cmcp read <上一步顯示的選項>
/disable
/select <另一專案/entry.json>
/enable codex
你的下一個正常問題。
/close
```

顯示專案、資料根、宿主、工作區、生命週期與 Session；一般提問每一輪新建原生 Session，透過正式工具接續共享 History。User 原話與每筆可見 Assistant 沿既有 adapter 保存，原角色、時間、版本及 reply binding 保留。一般文字不解析為控制命令；控制必須以 `/cmcp`（或同義的 `/control`）明示進入，人類 controller 與模型 reader 分權。

`/file <UTF-8路徑>` 是可選輸入，限定當前宿主工作區。單次命令亦可：

```text
cmcp-time project ask --config <entry.json> --host codex --prompt "正常問題"
cmcp-time project ask --config <entry.json> --host harness --prompt-file <工作區內的UTF-8檔案>
cmcp-time project ask --config <entry.json> --host harness --stdin
```

`--stdin` 讀取完整標準輸入；不是回填私人聊天或從另一宿主資料庫搬資料。每個單次 `ask` 明示啟用一輪，完成後撤權、關閉宿主及本次 broker。`open` 可以先查看再啟用；切換專案必須先停用。

## 停止與權限

### 同一 Codex Session 的原生壓縮

在同一次 `project open` 中，先 `/enable codex` 並成功完成一般提問，才可輸入 `/compact` 或 `/compact 接續問題`。入口沿官方 `thread/resume` 取回剛才的原生 Session，呼叫 `thread/compact/start`；只有同一 Session 的 `contextCompaction` 項目完成及原生 turn 完成均被觀測，才記錄壓縮完成。附上的接續問題於壓縮之後沿正常生命週期保存、回答及正式回查。壓縮本身不偽造 User 訊息或原答，也不以新 Session 代替。

這項操作可能呼叫原生模型；只保留必要壓縮生命週期、可見原答、來源閱讀及用量，不保存隱藏推理正文。停用或切換專案後，入口不再記住這次壓縮目標，不能用舊參照自動恢復授權。目前只提供已查明接點的 Codex 路線；不宣稱 Harness SDK 亦有同等原生壓縮能力。

### 非正常退出後的明確恢復

```text
cmcp-time project recover --config <entry.json>
```

先列出正式工作清冊中的未結束工作、原 owner PID、目前存活狀態及外部結果是否未知；查看不啟動宿主、不建 grant、不呼叫模型。互動終端可選擇畫面上的編號，直接 Enter 保持不變。結構化整合可使用清冊回傳的 `--option <編號> --snapshot <當次快照>`；清冊變動或選項過期即拒絕。

正式恢復只接受已退出且能對應原工作的 owner。原 writer lease 會連同雜湊與原位置保留於同範圍的 `runtime-recovery/preserved-leases`，工作標記為中斷且外部結果未知；不刪舊鎖、不搶存活 owner、不自動重送外部請求。PID 存活、原件漂移、連結別名、owner 不一致或釋放尚未確認時保持阻擋。這個操作不清除 History、媒體、控制或原時間；曾送出但尚未確認的外部結果，仍不能當作成功或安全重試。

`/disable`、`/close` 或 Ctrl+C 先進入 `stopping`，不接受新問題或新的權限回覆。尚在等待設定／檔案／broker 啟動的舊要求會失效，不能晚到重新啟用。Codex 沿官方 `turn/interrupt` 與既有票證撤權，取消後的新 item 不保存；Harness 先核對 broker owner 是否為本輪固定 Session，相符才立即撤權，再沿官方 `shutdown` dispose 本次 SDK 所有的 Session。此人類停止操作不刷新宿主舊票證，也不撤別人的 writer。確認宿主釋放與程序退出後，撤回入口觀測 Session，再關閉本次 broker；任何釋放未確認都保留 `stopping`，不報 `closed`。

broker pipe 已有人使用時拒絕開啟；不接管、停止或搶另一個入口的 writer。新的入口／Session 不自行解除 shared OFF、Clean 或開啟主動與 Pin。控制指令採共用控制契約，例如 `set enabled off`、`set clean on`、`dnd off`、`clear-buffer`；讀原文亦受目前授權守護。停用保留既存原文。

Codex 原生權限要求會顯示 method、requestId 與原參數。命令執行／檔案變更核准可以 `/approve <requestId> accept` 或 `decline`，真實原結果直接送回官方 app-server；不自動准許，也不改全域權限。複雜的原生問題可由整合介面 `respond({requestId,result})` 原樣回傳，或進階 `/response <requestId> <result JSON>`。單次非互動輸入若需要人類回覆會明示 `native_input_required` 並停止，應改用 `open`；TTY 單次命令的普通核准會互動詢問。

現裝 Harness SDK 0.2.0-rc.2 的 RPC 只有 `initialize`、`session/prompt`、`shutdown`，沒有原生 approval／question 回傳 RPC。入口保留該宿主既有策略，遇到不支援的原生核准要求明示 unsupported 並停止，不捏造取消或准許介面。這是 SDK 能力界線，不宣稱等同原生 Desktop GUI。日常 Desktop profile、全域設定與私人 Session 不由此入口更動。

## 離線驗證

執行前把 `CMCP_TEST_OUTPUT_ROOT` 設為本次明示的測試輸出目錄，所有合成原件保留其中：

```text
node --test adapters/project-entry/entry.test.mjs adapters/project-entry/codex-driver.test.mjs adapters/project-entry/lifecycle.test.mjs adapters/project-entry/recovery.test.mjs
```

測試使用 fake broker／SDK／app-server 與新建合成資料，涵蓋設定移植、兩專案、提示原文、直接 CLI、控制分權、原生權限回傳、停止競態、晚到事件、釋放未確認及正式壓縮事件。另以本測試自行啟動的隔離子程序實際非正常退出，驗证保留舊 lease、正式恢復、原文不變及舊票券晚到拒絕；不停止使用者程序。離線與子程序 PASS 不代表本輪真模型／GUI 已驗；實際模型驗收由使用者授權的主流程執行。
