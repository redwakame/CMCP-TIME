# 選配 MCP 與自架服務

CMCP 保持 Skill-first。既有本機 CLI、原生宿主與正式 reader 不以常駐服務為必要條件。MCP 是同一核心的選配傳輸；它不替模型回答，也不取代原文、時間與控制。

```sh
cmcp-time mcp help
cmcp-time service help
cmcp-time data help
```

請依 [MCP 操作說明](../adapters/mcp/README.md) 建立明示專案、持久資料及身分。`service` 與 `mcp` 使用同一命令契約。[設定範例](interop-config-examples.md) 與 [能力矩陣](interop-capabilities.zh-TW.md) 區分可設定與已驗。

模型只取得目前 scope 的正式讀取工具。宿主原始 User 與可見 Assistant 必須由可信生命週期擷取；模型自稱角色或傳時間參數不會變成已核對原文。人的授權、重試與共用控制使用獨立入口。一般聊天不自動加入專案或開啟主動。

保存狀態分列已保存、待登錄、登錄失敗及目前正式閱讀資格；跨宿主可用另需接收端綁定。查看不自動重試。人類可由既有選單或正式 `retry-registration` 操作重試，OFF／Clean 與取消守護仍有效，不擴容量或刪原文。

HTTP 預設 loopback。遠端使用需另設 HTTPS／可信反向代理與明示認證；預先配置 JWT 不冒充 OAuth 登入服務。簽署金鑰與 controller 不交給模型；同一 OS 帳戶若有任意 Shell／檔案權限，不是秘密隔離邊界。程式、持久資料、暫存與憑證分工，不以暫存資料夾充當 History。

停止服務後再沿正式 `data export/verify/restore` 備份還原；完整參數見 `data help`。重啟後重新核對對話授權，不能靠舊 token／傳輸 session 恢復舊執行資格。停用或解除介接保留 History 與媒體。

CMCP-TIME 0.1.0 提供此選配本機／自架介面。本機驗證不是雲端部署或平台審核；見[版本身分](release-0.1.0.md)及[正式操作](release-readiness.zh-TW.md)。Hermes 安裝、啟用與停用另見[介接說明](../adapters/hermes/README.md)。

## Hermes 的一般入口

依 Hermes README 在獨立環境安裝指定官方版本；不修改全域 PATH。下列 `<...>` 需換成自己的明示路徑，不把金鑰值放進命令。`credential-file` 指向已授權的既有憑證檔；Windows 原生工具需要已配置的 Git Bash，可用 `--git-bash <bash.exe>` 指定。

```text
cmcp-time hermes configure --service <mcp-service.json> --python <Python> --home <新的專案profile> --credential-file <既有憑證檔> --output <hermes.json>
cmcp-time hermes inspect --config <hermes.json>
cmcp-time hermes chat --config <hermes.json> --session <新Session> --authorize-session --stdin
```

啟動前先運行對應 MCP 服務；輸入從 stdin 提交。下一輪可使用同一 Session 的正常歷史，新 Session 則經 CMCP 正式回查。拿掉 `--authorize-session` 並改用 `--native-only`，只走原生宿主；既有原件不刪除。日常額外紀錄預設只有中繼資料；Hermes 自有聊天紀錄仍由宿主管理，與 CMCP 保存控制分開。需要停機時使用正式取消／停止入口並等釋放回執，不強殺其他工作。

`hermes harness-configure`／`harness-chat` 重用既有 Harness driver，供明示合成互通驗收，後者必須加 `--synthetic-evidence`；不能拿這個會記完整合成證據的 profile 當日常私人聊天模式。其他宿主或遠端平台的帳戶核准另列能力矩陣。

## 相依準備與服務命令

使用全新 Python 3.11–3.13 虛擬環境（實跑 3.12.14）。先取得官方 Hermes v2026.9.24、commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`（套件 0.21.5）；下列 editable 路徑必須是該已核對來源，不是其他代理 checkout。Windows 另備 Git Bash，已驗可攜版為 2.56.0.windows.1；`--git-bash <bash.exe>` 只影響子程序。一般 wheel 安裝未驗通過，詳見[相依重建](../adapters/hermes/dependencies.md)。

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

`<venv-python>` 指該環境自身執行檔，不要求啟用環境或改全域 PATH；各占位符須換成自己的值。npm 安裝已包含固定 MCP SDK 相依；來源 checkout 使用 `npm ci`。第一個終端機運行 start，另一個查看 health／capabilities，最後 stop。初始化針對此明示新專案開啟 User／Assistant 保存、主動／Pin OFF，每個 Session 仍須加入，不匯入既有聊天。`--stdin` 寫入正常問題後須送 EOF 才開始回答；亦可改用 `--message "你的問題"`。
