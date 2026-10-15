# 零模型測試與平台界線

## 0.1.1 本輪適用重跑

先依下方安裝相依並選本次專用輸出位置。由固定 `v0.1.1` 來源執行下列七份測試，原定結果為 96 項；不包含真模型、GUI 或全 S1 矩陣：

```text
node --test --test-concurrency=1 scripts/cmcp-setup-maintenance.test.mjs scripts/cmcp-proactive-description.test.mjs scripts/cmcp-continuity-report-scope.test.mjs scripts/cmcp-continuity-scoped-proposal.test.mjs adapters/continuity-model-view.test.mjs adapters/continuity-model-view-bounds.test.mjs adapters/continuity-delivery.test.mjs
```

以上七份測試支援 `CMCP_TEST_PRODUCT_ROOT` 指向另行安裝的同版實包；測試本身仍從固定 tag 來源執行。可另指定 `CMCP_SETUP_MAINTENANCE_ROOT`、`CMCP_PROACTIVE_TEST_ROOT`、`CMCP_TEST_OUTPUT` 為新的隔離輸出目錄。`scripts/cmcp-continuity-source-use.test.mjs` 可單獨核對公開 fixture 的來源用途；其兩個私人原件位置已遮蔽，原文、角色、時間、hash 與斷言未改。

較寬 C27 容量測試仍有既存 163／236 超限 FAIL，不能把上面定點通過稱為全套通過。H4 真宿主與固定原件的不同證據層級見[四語 0.1.1 說明](release-0.1.1.md)。本頁命令可供重跑，是否在指定平台通過仍需該平台實際結果。

本頁供 GitHub 完整來源使用。npm 執行套件刻意不附全部測試；驗證實際 npm 包時，使用同版來源或配對證據包內的測試，並將 `CMCP_PRODUCT_ROOT` 指向實際安裝的套件根。不要用作者管理根、舊日期資料夾或日常 History 當測試位置。

下列命令不需要模型金鑰，也不會呼叫模型。純契約／替身測試、真本機服務測試與真宿主驗收分開；其中一組通過不能代稱其他層級通過。本次已驗版本及作業系統見 [支援矩陣](interop-capabilities.zh-TW.md)，不能只因命令可在另一平台啟動就宣稱已驗。

## 1. 依賴及明確的輸出位置

先進入這份來源的 Git 根。Node 最低宣告為 22.16；具名實跑版本依發布驗證資訊。以套件鎖定依賴正常安裝：

```text
npm ci
```

本次鎖檔的 94 個相依項目沒有宣告安裝腳本，且 registry URL／完整性欄位已核對；這是指定鎖檔的檢查結果，不是供應鏈安全認證。更新鎖檔後須重新核對。

以下環境變數只影響目前終端；每次選擇一個新目錄，不指向現有資料。本次已將相連測試的輸出預設收在來源 clone 內；仍建議明示獨立的輸出目錄，便於區分每次結果。即使以 `CMCP_PRODUCT_ROOT` 指向另一份實際安裝套件，測試輸出也不應混入該套件或日常資料。

Windows PowerShell：

```powershell
$cmcpSource = (Get-Location).Path
$cmcpRun = Join-Path $cmcpSource ('logs/tests/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $cmcpRun | Out-Null
$env:CMCP_PRODUCT_ROOT = $cmcpSource
$env:CMCP_TEST_OUTPUT_ROOT = Join-Path $cmcpRun 'cases'
$env:CMCP_BACKUP_TEST_ROOT = Join-Path $cmcpRun 'backup'
$env:PYTHONPYCACHEPREFIX = Join-Path $cmcpRun 'pycache'
```

Linux／其他 Unix shell：

```sh
export CMCP_PRODUCT_ROOT="$PWD"
export CMCP_TEST_OUTPUT_ROOT="$PWD/logs/t/cases"
export CMCP_BACKUP_TEST_ROOT="$PWD/logs/t/backup"
export PYTHONPYCACHEPREFIX="$PWD/logs/t/pycache"
mkdir -p "$CMCP_TEST_OUTPUT_ROOT" "$CMCP_BACKUP_TEST_ROOT"
```

Unix 範例中的 `logs/t` 必須是本次專用的新目錄；重跑改用另一個短名稱。真服務使用 Unix socket，最長路徑含生成子目錄必須在 100 bytes 內；若 clone 路徑過長，改在較短的 clone 路徑執行，不刪鎖、不繞過路徑或 scope 檢查。

只有明示讀取 `CMCP_PRODUCT_ROOT` 的測試才會切換至指定實作，本頁的 MCP 及備份測試支援此方式。驗已安裝 npm 包時，將該變數指向套件的絕對路徑；測試指令仍從同版完整來源執行，輸出保留在目前來源的 `logs/`。其餘直接相對匯入的契約／元件／宿主替身測試仍是來源測試，不冒稱已安裝包測試。確認該安裝具有自己的 Node 相依；Desktop 部署的 `product` 副本不能當成 MCP 相依已安裝。

## 2. 可攜契約與替身核對

以下測試使用合成資料與受控替身，不啟動真實宿主、HTTP 服務或模型：

```text
node --test adapters/control/contract.test.mjs adapters/hermes/bridge.test.mjs
node adapters/deepseek-harness/native-desktop/client.test.mjs
```

`client.test.mjs` 是離線 DOM／事件替身，不是官方 Desktop 畫面、輸入法或前景操作證據。

Hermes 的 Python 控制／可見材料測試只需支援範圍內的 Python 與標準函式庫，不需模型金鑰：

```text
python -m unittest discover -s adapters/hermes/tests -v
```

Python 測試直接載入同目錄來源；`CMCP_PRODUCT_ROOT` 不會替它切換實作。若要核對已安裝包，須使用配對證據包的專用重跑入口，或另留完整的同版測試與實作對照，不把來源測試說成安裝包測試。

## 3. 本機檔案與相連生命週期

完成第一節的輸出設定後執行：

```text
node --test adapters/hermes/cli.test.mjs adapters/hermes/peer.test.mjs
node --test adapters/data-backup/backup.test.mjs
```

這些測試會在專用輸出目錄建立合成設定、檔案、授權替身或備份。Hermes CLI／peer 使用受控宿主替身，沒有啟動真 Hermes／Harness 或發送模型請求；備份測試的路徑別名反例會使用 Windows junction 或 Unix symlink，不能擴稱另一平台已驗。

## 4. 真本機 MCP 與 writer 控制

這組會建立短時本機服務、stdio 子程序及真官方 MCP client；只用合成原文和測試憑證，測試完成後正常停止：

```text
node --test adapters/mcp/mcp.test.mjs
node --test adapters/shared-project/shared-project.test.mjs
```

Windows 使用 named pipe；Unix 使用該專案內的 socket。HTTP 只綁本機 loopback，不開公網。Unix／Node 最低版本若未在當次實際執行，結果列未驗，不能將 Windows 結果搬成跨平台 PASS。

輸出可能包含一次性測試私鑰、token 或能力票券。保留本機原件，不將整個 `logs/` 提交 GitHub、上傳 Release 或包進 npm。只分享已排除憑證的測試摘要／核准索引。若測試中斷，先核對所記錄的服務身分與正常停止回執，不整批結束 Node、不刪鎖或永久刪除資料。

## 5. 判讀結果

- 測試失敗、SKIP、缺相依及平台不支援分列；不要以全面 SKIP 改成 PASS。
- 這些命令不驗真宿主語意、GUI、公網 TLS 或平台帳戶審核。
- 需要正式原文、實際原答及模型材料的驗收，沿已授權宿主與合成資料另行執行；離線檢查不自行開模型。
- 不要直接執行未讀過的全部歷史 smoke 指令。其他測試若採不同輸出變數，先依其實際入口指定本專案內的新位置。
