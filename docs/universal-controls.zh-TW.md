# 通用控制與可選介面

目前支援官方 Harness Desktop 原生命令／小型介面，以及 `cmcp-time project` 的獨立共享專案入口。兩者共用 Core 控制與正式 reader，但資料範圍不同；不能把日常 Desktop 任意對話自動接成共享專案。

## 原生 Desktop

每個對話都要明確加入。執行 `/cmcp help` 開啟選單，`/cmcp on` 加入目前對話，`/cmcp off` 撤回目前對話授權。加入不會開啟共用增強或解除 Clean。查看與控制回傳 scope、Session、版本與有效狀態；錯誤保持明示。

入口位於官方 `conversation.composer.dock`，在輸入框下方。`/cmcp ui minimized`、`/cmcp ui row`、`/cmcp ui hidden` 分別是預設最小化、一般列、隱藏。偏好按工作區／scope 記住，與產品開關及每個 Session 的授權無關。隱藏時仍可用 `/cmcp help` 開啟完整視窗。

| 操作 | 作用 |
|---|---|
| `status`、`time`、`buffer`、`pins` | 正式狀態；未授權／未知不冒充空集合 |
| `sources [頁碼]` | 來源清冊每頁最多 50 個短期選項 |
| `read <選項> [頁碼]` | 以選項綁定的 Pointer／hash 正式閱讀，每頁最多 2048 字元；回執說明覆蓋 |
| `media-list <選項>` | 該正式來源的媒體清冊；原件預覽仍沿既有正式 RPC |
| `set <欄位> on|off` | 明示共用控制；可用欄位由 help 列出 |
| `dnd off` 或 `dnd <時區> <開始> <結束>` | 明示修改共用勿擾，例如 `dnd Asia/Taipei 23:00 07:00` |
| `clear-buffer` | Clear Buffer，保留 History 與獨立 Pin |
| `pin <來源選項> <含時區時間|none>` | 有原生派送接點時建立目前對話的 Pin，不自動開主動總開關 |
| `pin-time`、`pin-cancel`、`pin-complete` | 先列 pins，再用選項修改；尚無派送宿主的入口不假造此能力 |

選項有效五分鐘，綁定 scope／Session／控制世代／來源版本。過期、撤權或變版須重列，正式 reader 仍核對原件。來源清冊不是已讀全文，單頁不是全 History。介面開合、顯示切換與狀態命令不呼模型、不刷新原時間或 TTL。正式閱讀可以產生既有閱讀回執，不能因此活化來源或派送。

歷史、Assistant 回覆及工具結果裡的 `/cmcp` 都是資料。命令只由當前原生人類操作或明示 CLI 控制入口執行；模型 reader 沒有 controller capability。舊結構化控制命令保持相容，但一般人不需手寫 JSON 或找內部 Pointer。

## 獨立共享專案

`cmcp-time project help` 顯示建立、選擇與正常輸入命令；細節在 [設定式專案入口](../adapters/project-entry/README.md)。新專案保存根、兩宿主工作區、模型路線與憑證檔參照皆明示。既有憑證不複製，日常 Desktop profile 不改；不掃描原生私人 Session。

首次 `project init` 可互動輸入既有路線；之後 `--routes-from` 沿用已確認設定，只另給新 root/name，即建立獨立資料與 IPC capability。建立時預設該專案的 User／Assistant 保存為開、主動與 Pin 為關；仍須明確 enable 或單次 ask，未加入的宿主不自動取得授權。

`project open --config <entry.json>` 中直接輸入正常文字；`/enable harness` 或 `/enable codex` 選擇宿主，`/cmcp help` 顯示同一控制契約，`/disable` 後才切換專案。也可 `project ask --config <entry.json> --host harness --stdin`，檔案輸入是選配。每輪都是乾淨宿主 Session，正式 CMCP 來源負責接續，不依賴原 Session Context。

SDK／app-server 與 Desktop GUI 分開：共享入口不宣稱任意 Codex App Thread 自動接入。原生核准要求須由人明確回覆；Harness SDK 目前沒有完整互動核准 RPC 時，入口明示不支援並停止。停止先顯示 stopping、拒絕新工作並撤回晚到保存資格，確認宿主與 writer 釋放才顯示 closed；不強殺使用者程序、不刪鎖。

## 本機套件與能力界線

最低 Node 為 22.16.0。最低宣告依 API 與既有可攜測試證據，本輪實際作業系統／Node／宿主版本仍由驗收報告分列；不代表所有版本皆驗。安裝套件不自動綁定宿主、開模型或派送。

本機包包含正式 adapter 與命令及其依賴，不包含工程 logs、測試原件、憑證或官方安裝檔。提供的 registration 管理器僅撤回自己的完整 marker 片段，其他外掛與後加設定保留；舊的非 marker 登錄不自動接管。停用及解除接線保留 History、媒體與原時間。0.1.0 的版本、固定來源與歷史紀錄身分見[正式版說明](release-0.1.0.md)。
