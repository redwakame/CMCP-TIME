# Hermes：同一專案的正式原文接續

本介接使用官方 Hermes 的 `AIAgent.run_conversation`、外掛 `pre_llm_call`／`post_llm_call` 與可見中間回答 callback，保存真實 User 輸入與實際 Assistant 原答。模型只取得正式唯讀 MCP 工具；不接受模型自行宣稱角色或原時間來新增 User 原文。這是官方程式的無 UI 入口，不能當成 Hermes 原生互動 TUI 或 Harness Desktop GUI 已驗收。

固定核對的官方來源是 NousResearch/hermes-agent `v2026.9.24`，commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`，套件版本 `0.21.5`、MIT。Python 支援宣告為 `>=3.11,<3.14`；本輪實際環境是 Windows Python 3.12.14。這是具名核對版本，不表示所有後續版本自動相容。

## 初始化與正常使用

先用產品 `cmcp-time mcp init` 建立全新的合成／明示專案，`--hosts hermes,harness`。依 [MCP 說明](../mcp/README.md) 啟動服務並明確設定共用控制。Hermes 加入對話不會解除既有 OFF、Clean 或停止保存。

以下 `<...>` 為使用者明確選定的絕對路徑；設定檔只存既有憑證檔的參照，不含金鑰。

```text
cmcp-time hermes configure --service <mcp-service.json> --python <隔離Python> --home <專案內新profile> --credential-file <既有DeepSeek憑證檔> --output <hermes.json> --git-bash <Windows的bash.exe>
cmcp-time hermes inspect --config <hermes.json>
cmcp-time hermes probe --config <hermes.json> --receipt <新回執.json>
cmcp-time hermes chat --config <hermes.json> --session <新對話名稱> --authorize-session --stdin
```

標準輸入結束後開始正常回答，也可用 `--message "問題"`。原生工具、Skills 與模型迴圈保留。每次執行結束釋放 CMCP writer；新 Session 必須重新明示授權。重用同一 Session 時 Hermes 原生歷史仍可存在；驗證跨 Session 必須使用不同名稱，並分開核對正式 CMCP 來源與原生歷史。

未提供 `--git-bash` 可使用宿主既有正常 Git Bash。Windows 官方原生檔案工具依賴 Git Bash；只安裝 Python 套件不代表檔案工具可執行。可明示可攜 Git 的 `bin/bash.exe`，只調整本次子程序環境，不改全域 PATH。

`probe` 只檢查官方匯入、外掛掛接與原生工具登錄，零模型；不等於工具實際執行或語意驗收。工具實際讀檔與模型接續的證據分列。

## 停用、取消與資料責任

```text
cmcp-time hermes chat --config <hermes.json> --session <獨立原生對話> --native-only --stdin
```

`--native-only` 不加入 CMCP、不附掛 CMCP 讀取工具，也不將原文另存 CMCP。Hermes 自己的 `SessionDB` 屬於原生紀錄，仍由該專案 profile 保存。CMCP OFF 不代表刪除或停止宿主自己的歷史；原生 profile、CMCP History、證據回執各自負責，不自動互相匯入。

按 Ctrl+C 由父程序送出本次 requestId 綁定的取消，接至官方 `AIAgent.interrupt(hard_cancel=True)`，同時沿正式 CMCP 取消與晚到守護。先顯示 `stopping`；只在子程序退出且收到正式 `released` 回執後顯示 `stopped`。未取得釋放時保留 `stopping`，不能強殺或刪鎖冒稱完成。不能保證每個模型供應商的已送請求立即停止計費；本輪不推估。

日常預設只記錄 hash、bytes、來源 pointer 與狀態，不另複製完整模型輸入／輸出或隱藏推理。只有明示隔離合成測試的 `--synthetic-evidence` 才可追加已正式保存成功的可見回答。停止保存或取消後，不以除錯回執旁路保留正文。

既有 DeepSeek 金鑰只由受控請求程序讀取目前指定的 `credentials-local v1` 參照 `DEEPSEEK_API_KEY`；不放環境變數給工具繼承，不輸出金鑰。此安排不是作業系統沙箱，不能宣稱同使用者任意原生檔案／終端工具與憑證已完全隔離；保持宿主現有權限與工具守護。

## 與既有 Harness 的順序接續

產品內重用既有官方 Harness SDK driver，連到同一個 broker，不另建 History。這個 peer 使用獨立 SDK profile，保留日常 Desktop。

```text
cmcp-time hermes harness-configure --config <hermes.json> --executable <官方Desktop執行檔> --cli <該Desktop隨附cli.js> --output <peer.json>
cmcp-time hermes harness-chat --config <peer.json> --session <明確新對話> --authorize-session --synthetic-evidence --stdin
```

peer 明確限合成驗收，因沿用的 SDK driver 會保存完整合成可見來源與回答取證；不能用於私人日常資料再宣稱只記中繼資料。真正日常 Harness 仍沿既有原生 Desktop CMCP 入口。本單不改原生 Desktop 模型、憑證或權限，也不宣稱任意日常對話已自動共享。

先結束當前宿主並取得 writer 釋放，再由另一宿主以新 Session 正常提問。不可複製另一宿主私人 Session 或直接讀底層 History；工具導航後仍須正式 open/read，並保留來源 Host、角色、原時間、版本、未定條件與 Assistant 提案的區別。

## 依賴與可重建性

Hermes 是外部依賴，不隨 CMCP 套件複製整個代理核心。詳見 [依賴重建](dependencies.md)。`configure` 不自動下載／安裝軟體，也不改全域 HOME、PATH、其他 profile。移除接線優先停用與不再使用本 profile；History 不會因解除接線而刪除。

本輪最終語意裁決、同版成品、模型用量與失敗保留以配對工程報告及原件索引為準；此說明不是模型自評 PASS。
