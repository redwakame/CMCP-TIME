# CMCP 資料備份與還原

此入口管理目前設定所指向的單一 CMCP 專案。使用者備份是一個有 `MANIFEST.json` 的目錄，與產品 tgz、工程證據 ZIP 分開。全程不呼叫模型，也不從目錄位置推定其他 scope 的授權。

## 一般操作

先從使用中的正常入口停止該資料區的 writer，保留其他工作。若仍有 writer 或未釋放的鎖，匯出會拒絕；本入口不搶鎖、不刪鎖。

```powershell
cmcp-time data inspect --config "C:\我的專案\runtime.json" --scope "我的專案"
cmcp-time data export --config "C:\我的專案\runtime.json" --scope "我的專案" --output "C:\備份\第一次" --authorize-backup
cmcp-time data verify --backup "C:\備份\第一次" --scope "我的專案"
cmcp-time data restore --backup "C:\備份\第一次" --scope "我的專案" --target "C:\還原\新的專案" --authorize-restore
```

`--config` 也接受正式 `entry.json`，其 scope 與資料位置由既有專案設定核對。獨立 runtime 設定中的相對路徑若不是相對設定檔所在目錄，另提供 `--project-root`。

要一併記錄原生 Harness 的 Pin 派送 Session 位置，匯出時加 `--desktop-config <原生 CMCP 設定 JSON>`。只透過既有 bridge 讀取同一 scope 的歷史目標關聯，不複製整份 trace、宿主私有對話或活動授權。未提供此選項時 manifest 明示未取得宿主目標；Core Pin 的來源目標、期限、完成／取消狀態仍保存。

## 還原後正式閱讀

目標必須是尚不存在的新目錄。成功回執會提供可直接使用的命令。還原不等於重新授權：共用 OFF、Clean 開啟、停止保存與派送，未設定任何宿主模型路線或憑證。

使用者確認要恢復這個專案的閱讀時，另行明示下列操作：

```powershell
cmcp-time data controls --config "C:\還原\新的專案\runtime.json" --scope "我的專案" --enabled true --clean false --authorize-controls
cmcp-time data sources --config "C:\還原\新的專案\runtime.json" --scope "我的專案" --authorize-reading
```

清冊會列出原角色、時間、Pointer／版本、來源雜湊，以及可貼上的 `read`、`media` 命令。選項附清冊版本，來源改變時舊選項拒絕，不以舊編號讀錯來源。

`read` 經正式 reader 取得原文；長文分頁並提供下一頁命令。`media` 先列圖片及可用狀態，再用列表提供的編號與版本將正式原件匯出至一個新檔案。一般讀取仍拒絕撤權、deleted 標記、缺件或雜湊不符的圖片。這些操作不刷新 User 原時間、Buffer TTL 或 Pin 資格。

`controls` 只修改明示的 `enabled`、`clean`；不建立保存授權、不改 DND，也不啟用主動或 Pin。這是一般使用者的 CLI 操作入口，不提供給模型作為自動同意機制。

## 保存範圍與必要原件

- 必要原件：完整 History 原文、圖片 bytes、原始角色與時間、Pointer／版本、reply binding、既有宿主／Session 來源關聯、Event 與控制的必要正式紀錄。
- 持續狀態：來源清冊、Buffer 原始活化時間與期限、Pin 原目標及建立／更新時間、完成／取消狀態、去重及撤權／刪除標記。
- 可重建投影：詞彙索引在還原時依設定由原文重建；來源清冊投影保留並與原文雜湊核對。
- 不匯入：帳戶憑證、controller capability、短期閱讀票券、writer 鎖、活動 Session 授權、provider grant、原始網路請求或宿主私有 Session。

資料格式版本為 1。匯出持有既有 common-input writer lease，並在前後比對正式快照；manifest 記逐檔 bytes／SHA-256、scope、快照版本、排除範圍。校驗可發現損壞，不能取代備份來源的信任或數位簽章。

原生檔案 History 本身是不可變來源，沒有另一套個別原文撤權 API；現有共用控制與保存撤權歷程被保留為歷史證據，新環境一律等待重新授權。不能把舊備份當作目前其他環境仍然有權讀取的證明。媒體既有 revoked／deleted 標記保持有效；已真正缺失的 bytes 不從其他位置補找，匯出會明示不完整並失敗。

還原 active Pin 保留其資料，但標示需要新的使用者授權。僅打開共用 proactive／pins 不會重啟它；使用者須透過既有正式修改時間操作再次授權。已完成或取消的 Pin 不能藉此復活。宿主目標只保留歷史資料，沒有自動重新登錄宿主或轉送政策。

## 失敗與停止

還原先在新目標內建立 staging，正式核對後才發布 `data`。失敗保留 `RESTORE-FAILED.json` 與部分資料；沒有完成回執就不稱成功。不能在相同失敗目標重跑覆寫，應指定另一個新目標。

容量滿、寫入拒絕、損壞或來源缺件都不會以刪舊 History、截短原答或刪圖片換取繼續。實體儲存容量恢復後可重試；正式單筆 bytes 上限與已綁定的設定仍須遵守，不透過備份入口暗改上限。備份範圍目前有 256 MiB 總量、32 MiB 中繼資料、20,000 個檔案的有界限制，超出會拒絕，不宣稱全量成功。

## 定點測試

```powershell
$env:CMCP_BACKUP_TEST_ROOT = "C:\驗收\本次備份測試"
node --test adapters/data-backup/backup.test.mjs
```

若要測已安裝的產品包，測試程式仍留在工程目錄，另設 `CMCP_PRODUCT_ROOT` 指向安裝後的套件根。測試會動態載入該套件的正式程式，不修改已安裝檔案。合成原件、失敗及原始回執都留在指定測試目錄；沒有刪除清理，也沒有模型或網路呼叫。測試包含受控 ENOSPC／EACCES 注入及中途失敗，並不代表真的塞滿磁碟或對使用者程序斷電。

