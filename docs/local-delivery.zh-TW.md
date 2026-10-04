# 0.1.0 的版本與環境界線

正式套件為 `@redwakame-skill/cmcp-time@0.1.0`，固定 GitHub tag 為 `v0.1.0`。實際來源以本版 `PUBLIC-FILES.json`、套件與發布資產雜湊核對。`main` 的後續文件不會改寫已發布 npm 套件；`latest`、`next` 是可變通道。詳見[正式版說明](release-0.1.0.md)。

既有 `NPM-CANDIDATE.json`、`VERIFICATION.json`、`PUBLICATION-VERIFICATION.json` 保留原來的歷史版本與範圍，不是 0.1.0 的新發布或最低版本回執。發布前曾以 rc.3 名稱作未公開本機增量，不可與已發布 rc.3 視為同成品。

最低 Node.js 宣告 `>=22.16.0`，依現用 API 與先前可攜證據；最新互通增量實跑 Windows Node 24.18.0。先前 Linux／Node22.16 的較早來源測試不代替每個新介接的實跑；模擬版本拒絕不等於最低版驗收。宿主與作業系統證據分列，不聲稱全平台。

套件含可重用程式、Skill、schema、文件、NOTICE 及 Node 相依鎖定資料，不含私人 History、憑證、整個宿主安裝或模型權重。Hermes 的外部 Python／Git Bash 相依另見[重建說明](../adapters/hermes/dependencies.md)。不含 node_modules 的 Desktop 程式副本不能當成已裝齊 MCP 相依的服務。

程式 prefix、正式持久資料根、宿主工作區、暫存與憑證分開。更新不遷移 scope；解除接線不刪 History。封裝、傳輸互通、模型語意、實際 GUI 與平台審核是不同層級。
